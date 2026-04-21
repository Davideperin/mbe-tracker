exports.handler = async function (event) {
  const MBE_USER = process.env.MBE_USERNAME;
  const MBE_PASS = process.env.MBE_PASSPHRASE;

  if (!MBE_USER || !MBE_PASS) {
    return { statusCode: 500, body: JSON.stringify({ error: "Credenziali MBE non configurate" }) };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const params = event.queryStringParameters || {};
  const ENDPOINT = "https://api.mbeonline.it/ws/e-link";
  const NS = "http://www.onlinembe.eu/ws/";
  const dateFrom = params.dateFrom || "2024-01-01";
  const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
  const refId = "REF-" + Date.now();

  const credentials = `<Credentials><Username>${MBE_USER}</Username><Passphrase>${MBE_PASS}</Passphrase></Credentials>`;

  // Try every meaningful combination and return ALL responses for debugging
  const attempts = [];

  const variants = [
    {
      name: "V3-with-System",
      action: "ShipmentsListV3Request",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">
<soapenv:Header/><soapenv:Body><ws:ShipmentsListV3Request><ws:RequestContainer>
<System>IT</System>${credentials}<InternalReferenceID>${refId}</InternalReferenceID>
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:RequestContainer></ws:ShipmentsListV3Request></soapenv:Body></soapenv:Envelope>`
    },
    {
      name: "V2-with-System",
      action: "ShipmentsListV2Request",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">
<soapenv:Header/><soapenv:Body><ws:ShipmentsListV2Request><ws:RequestContainer>
<System>IT</System>${credentials}<InternalReferenceID>${refId}</InternalReferenceID>
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:RequestContainer></ws:ShipmentsListV2Request></soapenv:Body></soapenv:Envelope>`
    },
    {
      name: "V1-with-System",
      action: "ShipmentsListRequest",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">
<soapenv:Header/><soapenv:Body><ws:ShipmentsListRequest><ws:RequestContainer>
<System>IT</System>${credentials}<InternalReferenceID>${refId}</InternalReferenceID>
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:RequestContainer></ws:ShipmentsListRequest></soapenv:Body></soapenv:Envelope>`
    },
    {
      name: "V1-no-System",
      action: "ShipmentsListRequest",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">
<soapenv:Header/><soapenv:Body><ws:ShipmentsListRequest><ws:RequestContainer>
${credentials}<InternalReferenceID>${refId}</InternalReferenceID>
<DateFrom>${dateFrom}</DateFrom><DateTo>${dateTo}</DateTo>
</ws:RequestContainer></ws:ShipmentsListRequest></soapenv:Body></soapenv:Envelope>`
    },
  ];

  for (const v of variants) {
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": `"${v.action}"` },
        body: v.body,
        signal: AbortSignal.timeout(10000),
      });
      const xml = await resp.text();
      attempts.push({ name: v.name, status: resp.status, first300: xml.substring(0, 300) });

      // If we get a valid OK response, parse and return immediately
      if (xml.includes("<Status>OK</Status>")) {
        const data = parseShipments(xml);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ ok: true, data, variant: v.name, raw: xml })
        };
      }
    } catch (e) {
      attempts.push({ name: v.name, error: e.message });
    }
  }

  // Return debug info so we can see what MBE is actually saying
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: false, debug: true, attempts })
  };
};

function parseShipments(xml) {
  const results = [];
  const tags = ["ShipmentItem", "ShipmentV3Item", "ShipmentV2Item", "Shipment", "ShipmentInfo"];
  for (const tag of tags) {
    const regex = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tag}>`, "gi");
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const b = m[1];
      const obj = {
        masterTracking: get(b, "MasterTrackingMBE") || get(b, "MbeTracking"),
        courierTracking: get(b, "CourierMasterTrk") || get(b, "CourierMasterTracking"),
        state: get(b, "ShipmentState") || get(b, "State") || get(b, "Status"),
        recipient: get(b, "Name"),
        companyName: get(b, "CompanyName"),
        city: get(b, "City"),
        country: get(b, "Country"),
        date: get(b, "ShipmentDate") || get(b, "OrderDate") || get(b, "Date"),
        courier: get(b, "Courier"),
        service: get(b, "Service") || get(b, "CourierService"),
        reference: get(b, "Referring") || get(b, "CustomerReference"),
        description: get(b, "Description"),
      };
      if (obj.masterTracking || obj.courierTracking || obj.recipient) results.push(obj);
    }
    if (results.length > 0) break;
  }
  return results;
}

function get(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[a-z]+:)?${tag}>([^<]*)<\\/(?:[a-z]+:)?${tag}>`, "i"));
  return m && m[1].trim() ? m[1].trim() : null;
}
