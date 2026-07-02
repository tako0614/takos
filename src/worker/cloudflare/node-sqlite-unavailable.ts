export class DatabaseSync {
  constructor() {
    throw new Error(
      "node:sqlite is not available in the Cloudflare Worker bundle. " +
        "The local persistent D1 fallback must stay outside deploy/cloudflare.",
    );
  }
}

export default {
  DatabaseSync,
};
