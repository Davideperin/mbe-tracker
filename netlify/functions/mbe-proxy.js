exports.handler = async function (event) {
  const MBE_USER = process.env.MBE_USERNAME;
  const MBE_PASS = process.env.MBE_PASSPHRASE;

  if (!MBE_USER || !MBE_PASS) {
    return { statusCode: 500, body: JSON.stringify({ error: "Credenziali MBE non configurate" }) };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const params = event.queryStringParameters || {};
  const action = params.action || "search";

  // Try multiple endpoints and SOAP formats
  const endpoints = [
    "https://api.mbeonline.it/ws/e-link",
    "https://www.onlinembe.it/ws/e-link",
    "https://api.mbeonline.it/ws/MBEShipping",
  ];

  const soapVariants = buildSOAPVariants(MBE_USER, MBE_PASS, action, params);

  let lastError = null;
  let lastRaw = "";

  for (const endpoint of endpoints) {
    for (const variant of soapVariants) {
      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": variant.action,
          },
          body: variant.body,
          signal: AbortSignal.timeout(8000),
        });

        const xml = await resp.text();
        lastRaw = xml;

        // Check for valid SOAP response (not a fault with no data)
        if (xml && xml.length > 50 && !xml.includes("Invalid credentials") && !xml.includes("AuthenticationFault")) {
          const data = parseXML(xml, action);
          // Return even if data is empty — include raw for debugging
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ ok: true, data, raw: xml, endpoint, variant: variant.name })
          };
        }
      } catch (e) {
        lastError = e.message;
      }
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: false, error: lastError, raw: lastRaw })
  };
};

function buildSOAPVariants(user, pass, action, params) {
  const dateFrom = params.dateFrom || "2024-01-01";
  const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
  const tracking = params.tracking || "";

  const credentials1 = `<Credentials><Username>${user}</Username><Passphrase>${pass}</Passphrase></Credentials>`;
  const credentials2 = `<credentials><username>${user}</username><passphrase>${pass}</passphrase></credentials>`;

  if (action === "search") {
    return [
      {
        name: "ShipmentsListRequest-v1",
        action: '"ShipmentsListRequest"',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
<soapenv:Header/><soapenv:Body>
<ws:ShipmentsListRequest>
${credentials1}
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:ShipmentsListRequest>
</soapenv:Body></soapenv:Envelope>`
      },
      {
        name: "SearchShipments-v1",
        action: '"SearchShipments"',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
<soapenv:Header/><soapenv:Body>
<ws:SearchShipments>
${credentials1}
<SearchParameters><DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo></SearchParameters>
</ws:SearchShipments>
</soapenv:Body></soapenv:Envelope>`
      },
      {
        name: "ShipmentsListV2Request",
        action: '"ShipmentsListV2Request"',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
<soapenv:Header/><soapenv:Body>
<ws:ShipmentsListV2Request>
${credentials1}
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:ShipmentsListV2Request>
</soapenv:Body></soapenv:Envelope>`
      },
      {
        name: "ShipmentsListV3Request",
        action: '"ShipmentsListV3Request"',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
<soapenv:Header/><soapenv:Body>
<ws:ShipmentsListV3Request>
${credentials1}
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:ShipmentsListV3Request>
</soapenv:Body></soapenv:Envelope>`
      },
    ];
  } else {
    return [
      {
        name: "TrackingRequest-v1",
        action: '"TrackingRequest"',
        body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
<soapenv:Header/><soapenv:Body>
<ws:TrackingRequest>
${credentials1}
<MasterTrackingsMBE><string>${tracking}</string></MasterTrackingsMBE>
</ws:TrackingRequest>
</soapenv:Body></soapenv:Envelope>`
      },
    ];
  }
}

function parseXML(xml, action) {
  const results = [];
  // Try many possible tag patterns for shipment list
  const patterns = [
    /ShipmentInfo|ShipmentItem|Shipment|shipment/g,
  ];
  // Extract any repeated block that looks like a shipment
  const blockRegex = /<([A-Za-z:]*(?:Shipment|shipment)[A-Za-z]*)[^>]*>([\s\S]*?)<\/\1>/gi;
  const found = new Set();
  let m;
  while ((m = blockRegex.exec(xml)) !== null) {
    const tag = m[1];
    const block = m[2];
    if (found.has(block)) continue;
    found.add(block);
    const obj = {
      masterTracking: extractTag(block, "MasterTrackingMBE") || extractTag(block, "IdMBE") || extractTag(block, "MBETracking"),
      courierTracking: extractTag(block, "CourierMasterTracking") || extractTag(block, "CourierTracking") || extractTag(block, "TrackingNumber"),
      state: extractTag(block, "ShipmentState") || extractTag(block, "State") || extractTag(block, "Status"),
      recipient: extractTag(block, "Name") || extractTag(block, "RecipientName") || extractTag(block, "Recipient"),
      city: extractTag(block, "City") || extractTag(block, "RecipientCity"),
      country: extractTag(block, "Country") || extractTag(block, "RecipientCountry"),
      date: extractTag(block, "ShipmentDate") || extractTag(block, "Date") || extractTag(block, "CreationDate"),
      courier: extractTag(block, "CourierName") || extractTag(block, "Courier") || extractTag(block, "CourierService"),
      service: extractTag(block, "ServiceName") || extractTag(block, "Service") || extractTag(block, "ServiceDesc"),
      reference: extractTag(block, "CustomerReference") || extractTag(block, "Reference") || extractTag(block, "ExternalReference"),
    };
    if (obj.masterTracking || obj.courierTracking || obj.recipient) {
      results.push(obj);
    }
  }
  return results;
}

function extractTag(xml, tag) {
  const patterns = [
    new RegExp(`<(?:[a-zA-Z]+:)?${tag}>([^<]*)<\/(?:[a-zA-Z]+:)?${tag}>`, "i"),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}
