import { describe, expect, it } from 'bun:test';
import { attempt } from '../src/telegram/reply.ts';

describe('attempt', () => {
  it('reports success when the call goes through', async () => {
    expect(await attempt('noop', Promise.resolve('ok'))).toBe(true);
  });

  it('counts "message is not modified" as success, since the screen already matches', async () => {
    const rejection = Promise.reject(
      new Error("Call to 'editMessageText' failed! (400: Bad Request: message is not modified: specified new message content and reply markup are exactly the same)"),
    );
    expect(await attempt('edit', rejection)).toBe(true);
  });

  it('reports a real failure without throwing', async () => {
    expect(await attempt('edit', Promise.reject(new Error('message to edit not found')))).toBe(false);
  });
});
