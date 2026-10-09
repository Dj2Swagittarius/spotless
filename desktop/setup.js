// First-run / "Change server…" page. The main process passes the address to prefill (?url=), why the
// last attempt failed (?error=) and the currently saved server (?current=). Cancel goes back to that
// server, so it is only offered when the page was opened on purpose, not because the server is down.
const params = new URLSearchParams(location.search);
const form = document.getElementById('form');
const input = document.getElementById('url');
const error = document.getElementById('error');
const connect = document.getElementById('connect');
const cancel = document.getElementById('cancel');
const scan = document.getElementById('scan');
const scanStatus = document.getElementById('scan-status');
const servers = document.getElementById('servers');

input.value = params.get('url') ?? '';
error.textContent = params.get('error') ?? '';
cancel.hidden = !params.get('current') || params.has('error');
input.select();

async function connectTo(url) {
  connect.disabled = true;
  connect.textContent = 'Connecting…';
  error.textContent = '';
  try {
    const result = await window.spotlessDesktop.connect(url);
    if (!result.ok) error.textContent = result.error;
  } catch (err) {
    error.textContent = String(err?.message ?? err);
  } finally {
    connect.disabled = false;
    connect.textContent = 'Connect';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  connectTo(input.value);
});

scan.addEventListener('click', async () => {
  scan.disabled = true;
  scan.textContent = 'Scanning…';
  scanStatus.textContent = 'Looking for Spotless on this computer and your local network. This takes a few seconds.';
  servers.replaceChildren();
  try {
    const found = await window.spotlessDesktop.scan();
    scanStatus.textContent = found.length
      ? `Found ${found.length === 1 ? 'a server' : `${found.length} servers`}. Pick one to connect.`
      : 'No Spotless server answered on ports 3000, 4000, 8080 or 80. Enter its address above instead.';
    for (const server of found) {
      const button = document.createElement('button');
      button.type = 'button';
      const address = document.createElement('span');
      address.textContent = server.url;
      const version = document.createElement('span');
      version.className = 'version';
      version.textContent = server.ok ? (server.version ? `v${server.version}` : '') : 'reports a problem';
      button.append(address, version);
      button.addEventListener('click', () => {
        input.value = server.url;
        connectTo(server.url);
      });
      const item = document.createElement('li');
      item.append(button);
      servers.append(item);
    }
  } catch (err) {
    scanStatus.textContent = `Scan failed: ${err?.message ?? err}`;
  } finally {
    scan.disabled = false;
    scan.textContent = 'Scan again';
  }
});

cancel.addEventListener('click', () => window.spotlessDesktop.cancel());
