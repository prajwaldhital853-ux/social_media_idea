/** Windows refuses a file outright with errno -4094 when the machine runs out
 *  of memory, so an otherwise green run must not abort over a PNG that could
 *  not land. Retry those writes; every other error stays fatal. */
const RETRYABLE = /UNKNOWN|EBUSY|EPERM|ENOMEM/;

export const retryWrite = async run => {
  for (let i = 0; ; i++) {
    try {
      return await run();
    } catch (err) {
      if (i >= 5 || !RETRYABLE.test(`${err?.code || ''} ${err?.message || ''}`)) throw err;
      await new Promise(r => setTimeout(r, 400));
    }
  }
};
