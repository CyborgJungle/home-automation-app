// Plain timestamped logging; systemd's journal keeps it (`journalctl -u home-agent -f`).
function write(level, scope, args) {
  const time = new Date().toISOString().slice(11, 19);
  console[level === 'debug' ? 'log' : level](`${time} ${level.toUpperCase().padEnd(5)} [${scope}]`, ...args);
}

export function createLogger(scope) {
  return {
    debug: (...args) => process.env.DEBUG && write('debug', scope, args),
    info: (...args) => write('info', scope, args),
    warn: (...args) => write('warn', scope, args),
    error: (...args) => write('error', scope, args),
    child: (name) => createLogger(`${scope}:${name}`),
  };
}
