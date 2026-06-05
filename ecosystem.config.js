module.exports = {
  apps: [{
    name: 'soapy-whatsapp-agent',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    kill_timeout: 20000,
    max_restarts: 10,
    min_uptime: 30000,
    restart_delay: 5000,
    autorestart: true,
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--unhandled-rejections=strict',
    },
  }],
};
