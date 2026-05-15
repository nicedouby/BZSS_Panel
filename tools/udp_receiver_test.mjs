import dgram from "node:dgram";

const port = Number.parseInt(process.env.UDP_TEST_PORT || "39001", 10);
const host = process.env.UDP_TEST_HOST || "0.0.0.0";

const server = dgram.createSocket("udp4");

server.on("error", (err) => {
  console.error("[udp-test] error:", err);
  server.close();
});

server.on("message", (msg, rinfo) => {
  const text = msg.toString("utf8");

  console.log(`\n[udp-test] ${new Date().toISOString()} from ${rinfo.address}:${rinfo.port}`);
  console.log(text);

  try {
    const json = JSON.parse(text);
    console.log("[udp-test] parsed:", {
      schema: json.schema,
      type: json.type,
      eventId: json.eventId,
      serverId: json.serverId,
    });
  } catch {
    console.log("[udp-test] not json");
  }
});

server.on("listening", () => {
  const address = server.address();
  console.log(`[udp-test] listening on ${address.address}:${address.port}`);
});

server.bind(port, host);
