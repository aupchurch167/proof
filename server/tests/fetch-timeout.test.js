const { fetchWithTimeout } = require('../src/lib/fetchWithTimeout');

describe('fetchWithTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects when the request exceeds the timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const pending = fetchWithTimeout('https://core.example.test/slow', { method: 'GET' }, 5000);
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(5000);
    await expectation;
  });
});
