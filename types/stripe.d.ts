// Minimal type stub for 'stripe' — replaced by the real types after npm install stripe
declare module 'stripe' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObj = Record<string, unknown>

  interface CheckoutSession {
    id: string
    url: string | null
    payment_intent?: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata?: Record<string, string> | null
  }

  interface Refund {
    id: string
  }

  interface WebhookEvent {
    type: string
    data: { object: AnyObj }
  }

  class Stripe {
    constructor(apiKey: string, options?: AnyObj)
    checkout: {
      sessions: {
        create(params: AnyObj): Promise<CheckoutSession>
        retrieve(id: string): Promise<CheckoutSession>
      }
    }
    refunds: {
      create(params: AnyObj): Promise<Refund>
    }
    webhooks: {
      constructEvent(payload: string, sig: string, secret: string): WebhookEvent
    }
  }

  namespace Stripe {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Session = any
    namespace Checkout {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type Session = any
    }
  }

  export = Stripe
}
