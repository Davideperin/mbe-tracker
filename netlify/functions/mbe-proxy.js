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

  try {
    let soapBody = "";

    if (action === "search") {
      const dateFrom = params.dateFrom || "2024-01-01";
      const dateTo = params.dateTo || new Date().toISOString().slice(0, 10);
      const state = params.state || "ALL";

      soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:SearchShipments>
      <ws:Credentials>
        <ws:Username>${MBE_USER}</ws:Username>
        <ws:Passphrase>${MBE_PASS}</ws:Passphrase>
      </ws:Credentials>
      <ws:SearchParameters>
        <ws:ShipmentState>${state}</ws:ShipmentState>
        <ws:DateFrom>${dateFrom}</ws:DateFrom>
        <ws:DateTo>${dateTo}</ws:DateTo>
      </ws:SearchParameters>
    </ws:SearchShipments>
  </soapenv:Body>
</soapenv:Envelope>`;
    } else if (action === "detail") {
      const tracking = params.tracking;
      soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.it/ws/">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:GetShipment>
      <ws:Credentials>
        <ws:Username>${MBE_USER}</ws:Username>
        <ws:Passphrase>${MBE_PASS}</ws:Passphrase>
      </ws:Credentials>
      <ws:MasterTrackingMBE>${tracking}</ws:MasterTrackingMBE>
    </ws:GetShipment>
  </soapenv:Body>
</soapenv:Envelope>`;
    }

    const resp = await fetch("https://api.mbeonline.it/ws/e-link", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"${action === "search" ? "SearchShipments" : "GetShipment"}"`,
      },
      body: soapBody,
    });

    const xml = await resp.text();

    // Parse XML to JSON
    const shipments = parseShipmentsXML(xml, action);

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: shipments, raw: xml }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};

function parseShipmentsXML(xml, action) {
  // Extract shipment items from SOAP response
  const results = [];

  if (action === "search") {
    const itemRegex = /<(?:ws:)?ShipmentInfo>([\s\S]*?)<\/(?:ws:)?ShipmentInfo>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      results.push({
        masterTracking: extractTag(block, "MasterTrackingMBE"),
        courierTracking: extractTag(block, "CourierMasterTracking") || extractTag(block, "TrackingMBE"),
        state: extractTag(block, "ShipmentState") || extractTag(block, "State"),
        recipient: extractTag(block, "Name") || extractTag(block, "RecipientName"),
        city: extractTag(block, "City"),
        country: extractTag(block, "Country"),
        date: extractTag(block, "ShipmentDate") || extractTag(block, "Date"),
        courier: extractTag(block, "CourierName") || extractTag(block, "Courier"),
        service: extractTag(block, "ServiceName") || extractTag(block, "Service"),
        reference: extractTag(block, "CustomerReference") || extractTag(block, "Reference"),
      });
    }
  } else {
    // Detail response - look for tracking events
    const eventRegex = /<(?:ws:)?TrackingEvent>([\s\S]*?)<\/(?:ws:)?TrackingEvent>/gi;
    let match;
    while ((match = eventRegex.exec(xml)) !== null) {
      const block = match[1];
      results.push({
        date: extractTag(block, "Date"),
        time: extractTag(block, "Time"),
        location: extractTag(block, "Location") || extractTag(block, "City"),
        description: extractTag(block, "Description") || extractTag(block, "Status"),
      });
    }
  }

  return results;
}

function extractTag(xml, tag) {
  const patterns = [
    new RegExp(`<ws:${tag}>([^<]*)<\/ws:${tag}>`, "i"),
    new RegExp(`<${tag}>([^<]*)<\/${tag}>`, "i"),
  ];
  for (const p of patterns) {
    const m = xml.match(p);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}
