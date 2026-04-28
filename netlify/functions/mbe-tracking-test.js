// Netlify Function: test MBE TrackingRequest API with Basic Auth
// Usage: GET /.netlify/functions/mbe-tracking-test?tracking=IT0819-0B-...
// Returns: status, raw response, parsed result

exports.handler = async (event) => {
  const tracking = event.queryStringParameters?.tracking;

  if (!tracking) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Missing tracking parameter",
        usage: "/.netlify/functions/mbe-tracking-test?tracking=IT0819-0B-XXXXXXXX",
      }),
    };
  }

  // Credentials from environment variables (set on Netlify)
  const username = process.env.MBE_USERNAME;
  const passphrase = process.env.MBE_PASSPHRASE;

  if (!username || !passphrase) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Missing MBE credentials in environment variables",
        hint: "Set MBE_USERNAME and MBE_PASSPHRASE in Netlify env vars",
      }),
    };
  }

  // Build Basic Auth header
  const basicAuth = Buffer.from(`${username}:${passphrase}`).toString("base64");

  // Build SOAP envelope (without Credentials node — using Basic Auth instead)
  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://www.onlinembe.eu/ws/">
  <soapenv:Header/>
  <soapenv:Body>
    <ws:TrackingRequest>
      <RequestContainer>
        <InternalReferenceID>test-${Date.now()}</InternalReferenceID>
        <TrackingMBE>${tracking}</TrackingMBE>
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

    const responseText = await response.text();

    // Try to extract status from response
    const statusMatch = responseText.match(/<TrackingStatus>([^<]+)<\/TrackingStatus>/);
    const overallStatusMatch = responseText.match(/<Status>([^<]+)<\/Status>/);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: response.ok,
        httpStatus: response.status,
        httpStatusText: response.statusText,
        endpoint: "https://api.mbeonline.it/ws",
        tracking: tracking,
        username: username.substring(0, 5) + "***",
        parsedTrackingStatus: statusMatch ? statusMatch[1] : null,
        parsedOverallStatus: overallStatusMatch ? overallStatusMatch[1] : null,
        rawResponse: responseText.substring(0, 3000),
      }, null, 2),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Network error",
        message: error.message,
      }, null, 2),
    };
  }
};
