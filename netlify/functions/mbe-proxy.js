exports.handler = async function (event) {
  const MBE_USER = process.env.MBE_USERNAME;
  const MBE_PASS = process.env.MBE_PASSPHRASE;

  if (!MBE_USER || !MBE_PASS) {
    return { statusCode: 500, body: JSON.stringify({ error: "Credenziali MBE non configurate" }) };
  }

  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const params = event.queryStringParameters || {};
  const action = params.action || "search";
  const ENDPOINT = "https://api.mbeonline.it/ws/e-link";
  const NS = "http://www.onlinembe.eu/ws/";
  const credentials = `<Credentials><Username>${MBE_USER}</Username><Passphrase>${MBE_PASS}</Passphrase></Credentials>`;
  const refId = `<InternalReferenceID>REF-${Date.now()}</InternalReferenceID>`;

  try {
    const dateFrom = params.dateFrom || "2024-01-01";
    const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);

    // Try all three list versions in sequence until one returns shipments
    const variants = [
      { action: "ShipmentsListV3Request", tag: "ShipmentsListV3Request" },
      { action: "ShipmentsListV2Request", tag: "ShipmentsListV2Request" },
      { action: "ShipmentsListRequest",   tag: "ShipmentsListRequest"   },
    ];

    for (const v of variants) {
      const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="${NS}">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:${v.tag}>
      <ws:RequestContainer>
        <System>IT</System>
        ${credentials}
        ${refId}
        <DateFrom>${dateFrom}</DateFrom>
        <DateTo>${dateTo}</DateTo>
      </ws:RequestContainer>
    </ws:${v.tag}>
  </soapenv:Body>
</soapenv:Envelope>`;

      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": `"${v.action}"` },
        body: soapBody,
        signal: AbortSignal.timeout(10000),
      });
      const xml = await resp.text();

      // Check if response looks valid (has Status OK and not just an error)
      const hasOk = xml.includes("<Status>OK</Status>");
      const hasFault = xml.includes("Fault") || xml.includes("faultstring");
      const hasError = xml.includes("<Status>ERROR</Status>");

      if (hasOk && !hasError) {
        const data = parseShipments(xml);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data, raw: xml, variant: v.action }) };
      }

      if (!hasFault && !hasError && xml.length > 200) {
        // Might have data even without explicit OK
        const data = parseShipments(xml);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data, raw: xml, variant: v.action }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: "Nessuna variante API ha funzionato", raw: "" }) };

  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

function parseShipments(xml) {
  const results = [];
  const tags = ["ShipmentItem", "Shipment", "ShipmentInfo", "ShipmentListItem", "ShipmentV3Item", "ShipmentV2Item"];
  for (const tag of tags) {
    const regex = new RegExp(`<(?:[a-z]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[a-z]+:)?${tag}>`, "gi");
    let m;
    while ((m = regex.exec(xml)) !== null) {
      const b = m[1];
      const obj = {
        masterTracking: get(b, "MasterTrackingMBE") || get(b, "MbeTracking"),
        courierTracking: get(b, "CourierMasterTrk") || get(b, "CourierMasterTracking") || get(b, "CourierTracking"),
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
