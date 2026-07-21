import { App } from "obsidian";

export interface ObsidianTabsSettings {
  useTab: boolean;
  tabSize: number;
}

export interface ObsidianFoldSettings {
  foldIndent: boolean;
}

export interface ObsidianSmartListSettings {
  smartIndentList: boolean;
}

interface VaultWithHiddenConfig {
  config?: object;
}

function getHiddenObsidianConfig(app: App) {
  return (app.vault as unknown as VaultWithHiddenConfig).config ?? {};
}

export class ObsidianSettings {
  constructor(private app: App) {}

  isLegacyEditorEnabled() {
    const config: { legacyEditor: boolean } = {
      legacyEditor: false,
      ...getHiddenObsidianConfig(this.app),
    };

    return config.legacyEditor;
  }

  getTabsSettings(): ObsidianTabsSettings {
    return {
      useTab: true,
      tabSize: 4,
      ...getHiddenObsidianConfig(this.app),
    };
  }

  getFoldSettings(): ObsidianFoldSettings {
    return {
      foldIndent: true,
      ...getHiddenObsidianConfig(this.app),
    };
  }

  getSmartListSettings(): ObsidianSmartListSettings {
    return {
      smartIndentList: true,
      ...getHiddenObsidianConfig(this.app),
    };
  }

  isSmartIndentListEnabled() {
    return this.getSmartListSettings().smartIndentList;
  }

  getDefaultIndentChars() {
    const { useTab, tabSize } = this.getTabsSettings();

    return useTab ? "\t" : new Array(tabSize).fill(" ").join("");
  }
}
