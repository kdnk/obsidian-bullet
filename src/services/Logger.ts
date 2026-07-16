import { Settings } from "./Settings";

export type LogSink = (method: string, ...args: unknown[]) => void;

const consoleDebugSink: LogSink = (method, ...args) => {
  console.debug(method, ...args);
};

export class Logger {
  constructor(
    private settings: Settings,
    private sink: LogSink = consoleDebugSink,
  ) {}

  log(method: string, ...args: unknown[]) {
    if (!this.settings.debug) {
      return;
    }

    this.sink(method, ...args);
  }

  bind(method: string) {
    return (...args: unknown[]) => this.log(method, ...args);
  }
}
