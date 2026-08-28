import { describe, expect, it } from 'bun:test';
import { awaitEvent } from '../src/util/async.ts';
import { PendingRequests } from '../src/pocket/pending.ts';

describe('awaitEvent', () => {
  it('skips the wait when the value is already known', async () => {
    let subscribed = false;
    const value = await awaitEvent<number>({
      known: () => 7,
      subscribe: () => {
        subscribed = true;
        return () => undefined;
      },
      timeoutMs: 10,
      onTimeout: () => 0,
    });
    expect(value).toBe(7);
    expect(subscribed).toBe(false);
  });

  it('resolves with the first delivered value and unsubscribes', async () => {
    let unsubscribed = false;
    const value = await awaitEvent<string>({
      subscribe: (deliver) => {
        setTimeout(() => deliver('tick'), 1);
        return () => {
          unsubscribed = true;
        };
      },
      timeoutMs: 500,
      onTimeout: () => 'late',
    });
    expect(value).toBe('tick');
    expect(unsubscribed).toBe(true);
  });

  it('sends the request only after the listener is in place', async () => {
    const order: string[] = [];
    await awaitEvent<number>({
      subscribe: (deliver) => {
        order.push('subscribe');
        setTimeout(() => deliver(1), 1);
        return () => undefined;
      },
      timeoutMs: 500,
      onTimeout: () => 0,
      request: () => order.push('request'),
    });
    expect(order).toEqual(['subscribe', 'request']);
  });

  it('falls back to onTimeout when nothing arrives', async () => {
    expect(
      await awaitEvent<number | null>({
        subscribe: () => () => undefined,
        timeoutMs: 1,
        onTimeout: () => null,
      }),
    ).toBeNull();
  });

  it('rejects when onTimeout throws', async () => {
    const promise = awaitEvent<void>({
      subscribe: () => () => undefined,
      timeoutMs: 1,
      onTimeout: () => {
        throw new Error('gave up');
      },
    });
    expect(promise).rejects.toThrow('gave up');
  });
});

describe('PendingRequests', () => {
  it('settles the request that carries the matching id', async () => {
    const pending = new PendingRequests<string>(500, 'too slow');
    const first = pending.add(1);
    const second = pending.add(2);

    pending.resolve(2, 'second');
    pending.resolve(1, 'first');

    expect(await first).toBe('first');
    expect(await second).toBe('second');
    expect(pending.size).toBe(0);
  });

  it('gives an answer without an id to the oldest waiting request', async () => {
    const pending = new PendingRequests<string>(500, 'too slow');
    const first = pending.add(1);
    pending.add(2);

    pending.resolveOldest('answer');
    expect(await first).toBe('answer');
    expect(pending.size).toBe(1);
  });

  it('rejects one request or all of them', async () => {
    const pending = new PendingRequests<string>(500, 'too slow');
    const one = pending.add(1);
    const two = pending.add(2);

    pending.reject(1, new Error('refused'));
    expect(one).rejects.toThrow('refused');

    pending.rejectAll(new Error('stopped'));
    expect(two).rejects.toThrow('stopped');
    expect(pending.size).toBe(0);
  });

  it('rejects with its own message when the broker never answers', async () => {
    const pending = new PendingRequests<string>(1, 'broker did not acknowledge in time');
    expect(pending.add(1)).rejects.toThrow('broker did not acknowledge in time');
  });
});
