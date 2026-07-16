import { App, Modal, Plugin } from "obsidian";

import { Feature } from "./Feature";

import { Settings } from "../services/Settings";

interface AppHiddenProps {
  internalPlugins: {
    config: { [key: string]: boolean };
  };
  isMobile: boolean;
  plugins: {
    enabledPlugins: Set<string>;
    manifests: { [key: string]: { version: string } };
  };
  vault: {
    config: object;
  };
}

interface RuntimeProcessWindow extends Window {
  process?: {
    arch?: unknown;
    platform?: unknown;
  };
}

export function getRuntimeProcessInfo(win: Window): {
  arch: string | null;
  platform: string | null;
} {
  const processInfo = (win as RuntimeProcessWindow).process;
  return {
    arch: typeof processInfo?.arch === "string" ? processInfo.arch : null,
    platform:
      typeof processInfo?.platform === "string" ? processInfo.platform : null,
  };
}

class SystemInfoModal extends Modal {
  constructor(
    app: App,
    private settings: Settings,
  ) {
    super(app);
  }

  async onOpen() {
    this.titleEl.setText("System Information");

    const app = this.app as unknown as AppHiddenProps;
    const processInfo = getRuntimeProcessInfo(this.contentEl.win);

    const data = {
      process: {
        arch: processInfo.arch,
        platform: processInfo.platform,
      },
      app: {
        internalPlugins: {
          config: app.internalPlugins.config,
        },
        isMobile: app.isMobile,
        plugins: {
          enabledPlugins: Array.from(app.plugins.enabledPlugins),
          manifests: Object.keys(app.plugins.manifests).reduce(
            (acc, key) => {
              acc[key] = {
                version: app.plugins.manifests[key].version,
              };
              return acc;
            },
            {} as { [key: string]: { version: string } },
          ),
        },
        vault: {
          config: app.vault.config,
        },
      },
      plugin: {
        settings: { values: this.settings.getValues() },
      },
    };

    const text = JSON.stringify(data, null, 2);

    const pre = this.contentEl.createEl("pre");
    pre.setText(text);
    pre.setCssStyles({
      overflow: "scroll",
      maxHeight: "300px",
    });

    const button = this.contentEl.createEl("button");
    button.setText("Copy and Close");
    button.onClickEvent(() => {
      void navigator.clipboard.writeText("```json\n" + text + "\n```");
      this.close();
    });
  }
}

export class SystemInfo implements Feature {
  constructor(
    private plugin: Plugin,
    private settings: Settings,
  ) {}

  async load() {
    this.plugin.addCommand({
      id: "system-info",
      name: "Show System Info",
      callback: this.callback,
    });
  }

  async unload() {}

  private callback = () => {
    const modal = new SystemInfoModal(this.plugin.app, this.settings);
    modal.open();
  };
}
