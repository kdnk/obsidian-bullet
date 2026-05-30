import { Settings } from "./Settings";

export class Logger {
  constructor(private settings: Settings) {}

  log(method: string, ...args: unknown[]) {
    if (!this.settings.debug) {
      return;
    }

    console.info(method, ...args);
  }

  bind(method: string) {
    return (...args: unknown[]) => this.log(method, ...args);
  }
}
