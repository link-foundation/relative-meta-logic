// A live Node test-runner event adapter. It does not invent pass records or consume
// status/capability declarations. stdout/stderr from tests cannot forge events.
export default async function* issue183Reporter(events) {
  for await (const event of events) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      yield `${JSON.stringify({ nonce: process.env.RML_ACCEPTANCE_NONCE, type: event.type, data: event.data })}\n`;
    }
  }
}
