declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware from a verified Access Token. */
      userId?: string;
    }
  }
}

export {};
