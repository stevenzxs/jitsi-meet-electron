const guardedStreams = new WeakSet();

/** Logging must not interrupt a meeting when the launching terminal closes. */
function installStdioGuard({ stdout = process.stdout, stderr = process.stderr } = {}) {
  for (const stream of [stdout, stderr]) {
    if (!stream || guardedStreams.has(stream)) continue;
    guardedStreams.add(stream);
    let broken = false;
    const write = stream.write;
    stream.on('error', error => {
      if (error?.code !== 'EPIPE') throw error;
      // Do not log here: console itself writes to these streams.
      broken = true;
    });
    stream.write = function (...args) {
      if (!broken) {
        try {
          return write.apply(this, args);
        } catch (error) {
          if (error?.code !== 'EPIPE') throw error;
          broken = true;
        }
      }
      // Treat subsequent log output as discarded, without leaving callbacks pending.
      const callback = args[args.length - 1];
      if (typeof callback === 'function') process.nextTick(callback);
      return true;
    };
  }
}

module.exports = { installStdioGuard };
