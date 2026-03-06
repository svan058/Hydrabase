export const CONFIG = {
  apiKey: process.env['API_KEY'] ?? false,
  dhtPort: Number(process.env['DHT_PORT'] ?? 4545),
  dhtReannounce: 15*60*1_000, // Ms
  dhtRoomSeed: 'hydrabase',
  finalConfidence: 'avg(x, y, z)',
  hostname: process.env['EXTERNAL_IP'] ?? (await (await fetch('https://icanhazip.com')).text()).trim(),
  listenAddress: process.env['LISTEN_ADDRESS'] ?? '0.0.0.0',
  pluginConfidence: 'x / (x + y)',
  serverPort: Number(process.env['SERVER_PORT'] ?? 4545),
  soulIdCutoff: 32,
  upnpReannounce: 1800, // Seconds
  upnpTTL: 3600, // Seconds
  username: process.env['USERNAME'] ?? 'Anonymous',
}
