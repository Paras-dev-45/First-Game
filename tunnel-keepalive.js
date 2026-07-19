// tunnel-keepalive.js
// Auto-restarts localtunnel whenever it disconnects

const { execSync, spawn } = require('child_process');

function startTunnel() {
  console.log('\n[tunnel] Starting localtunnel on port 8080...');
  const proc = spawn('cmd', ['/c', 'npx -y localtunnel --port 8080'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  proc.stdout.on('data', (data) => {
    const text = data.toString().trim();
    if (text) {
      console.log('[tunnel] ' + text);
      // Highlight the URL clearly
      const match = text.match(/https?:\/\/[^\s]+\.loca\.lt/);
      if (match) {
        console.log('\n========================================');
        console.log('  GAME LINK: ' + match[0]);
        console.log('  Share this with your friend!');
        console.log('========================================\n');
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.log('[tunnel-err] ' + text);
  });

  proc.on('close', (code) => {
    console.log(`[tunnel] Disconnected (code ${code}). Restarting in 3 seconds...`);
    setTimeout(startTunnel, 3000);
  });
}

console.log('=== Shadow Sprint Tunnel Keep-Alive ===');
console.log('Tunnel will auto-restart if it drops.');
console.log('Press Ctrl+C to stop.\n');

startTunnel();
