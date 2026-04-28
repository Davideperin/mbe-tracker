// Netlify Function: sync MBE shipments status via API
// POST /.netlify/functions/mbe-sync
// Body: { trackings: ["IT0819-0B-...", ...] }
// Returns: { results: [{ tracking, status, deliveryDate, deliverySign, courierTracking }] }

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  let trackings;
  try {
    const body = JSON.parse(event.body || "{}");
    trackings = body.trackings;
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  if (!Array.isArray(trackings) || trackings.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing trackings array" }),
    };
  }

  if (trackings.length > 100) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Max 100 trackings per request" }),
    };
  }

  const username = process.env.MBE_USERNAME;
  const passphrase = process.env.MBE_PASSPHRASE;

  if (!username || !passphrase) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "MBE credentials not configured" }),
    };
  }

  const basicAuth = Buffer.from(`${username}:${passphrase}`).toString("base64");

  // Build SOAP body with multiple TrackingMBE entries
  const trackingNodes = trackings
    .map(t => `<TrackingMBE>${escapeXml(t)}</TrackingMBE>`)
    .join("\n      ");

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.eu/ws/">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:TrackingRequest>
      <RequestContainer>
        <InternalReferenceID>sync-${Date.now()}</InternalReferenceID>
      ${trackingNodes}
      </RequestContainer>
    </ws:TrackingRequest>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const response = await fetch("https://api.mbeonline.it/ws", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": "",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: soapBody,
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "MBE API error",
          httpStatus: response.status,
          response: text.substring(0, 1000),
        }),
      };
    }

    const responseText = await response.text();
    const results = parseTrackingResponse(responseText, trackings);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        count: results.length,
        results,
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Network error",
        message: error.message,
      }),
    };
  }
};

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseTrackingResponse(xml, requestedTrackings) {
  const results = [];
  // Split by TrackingResult blocks (multi-shipment response)
  const trackingResultPattern = /<TrackingResult>([\s\S]*?)<\/TrackingResult>/g;
  let match;
  let foundAny = false;

  while ((match = trackingResultPattern.exec(xml)) !== null) {
    foundAny = true;
    const block = match[1];
    results.push(parseTrackingBlock(block));
  }

  // If single shipment response (no TrackingResult wrapper), parse from RequestContainer
  if (!foundAny) {
    const rcMatch = xml.match(/<RequestContainer>([\s\S]*?)<\/RequestContainer>/);
    if (rcMatch) {
      const parsed = parseTrackingBlock(rcMatch[1]);
      // For single response, MBE doesn't include the tracking ID in the response,
      // so we use the one we requested
      if (!parsed.tracking && requestedTrackings.length === 1) {
        parsed.tracking = requestedTrackings[0];
      }
      results.push(parsed);
    }
  }

  return results;
}

function parseTrackingBlock(block) {
  const get = (tag) => {
    const m = block.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
    return m ? m[1] : null;
  };

  return {
    tracking: get("TrackingMBE"),
    status: get("TrackingStatus"),
    deliveryDate: get("DeliveryDate"),
    deliverySign: get("DeliverySign"),
    courierTracking: get("CourierTracking"),
  };
}
