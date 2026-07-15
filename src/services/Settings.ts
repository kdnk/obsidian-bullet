export type VerticalLinesAction = "none" | "toggle-folding";
export type KeepCursorWithinContent =
  | "never"
  | "bullet-only"
  | "bullet-and-checkbox";

export interface SettingsObject {
  styleLists: boolean;
  debug: boolean;
  stickCursor: KeepCursorWithinContent | boolean;
  betterEnter: boolean;
  betterVimO: boolean;
  betterTab: boolean;
  selectAll: boolean;
  listLines: boolean;
  outerListLines: boolean;
  listLineAction: VerticalLinesAction;
  dnd: boolean;
}

export type SettingsKey = keyof SettingsObject;

export interface SettingsChange {
  keys: ReadonlySet<SettingsKey>;
}

const DEFAULT_SETTINGS: SettingsObject = {
  styleLists: true,
  debug: false,
  stickCursor: "bullet-and-checkbox",
  betterEnter: true,
  betterVimO: true,
  betterTab: true,
  selectAll: true,
  listLines: true,
  outerListLines: true,
  listLineAction: "toggle-folding",
  dnd: true,
};

export interface Storage {
  loadData(): Promise<SettingsObject>;
  saveData(settings: SettingsObject): Promise<void>;
}

type Callback = (change: SettingsChange) => void;

interface Subscription {
  readonly keys: ReadonlySet<SettingsKey>;
  readonly callback: Callback;
}

export class Settings {
  private storage: Storage;
  private values: SettingsObject = { ...DEFAULT_SETTINGS };
  private subscriptions: Map<Callback, Subscription>;

  constructor(storage: Storage) {
    this.storage = storage;
    this.subscriptions = new Map();
  }

  get keepCursorWithinContent() {
    // Adaptor for users migrating from older version of the plugin.
    if (this.values.stickCursor === true) {
      return "bullet-and-checkbox";
    } else if (this.values.stickCursor === false) {
      return "never";
    }

    return this.values.stickCursor;
  }

  set keepCursorWithinContent(value: KeepCursorWithinContent) {
    this.update({ stickCursor: value });
  }

  get overrideTabBehaviour() {
    return this.values.betterTab;
  }

  set overrideTabBehaviour(value: boolean) {
    this.update({ betterTab: value });
  }

  get overrideEnterBehaviour() {
    return this.values.betterEnter;
  }

  set overrideEnterBehaviour(value: boolean) {
    this.update({ betterEnter: value });
  }

  get overrideVimOBehaviour() {
    return this.values.betterVimO;
  }

  set overrideVimOBehaviour(value: boolean) {
    this.update({ betterVimO: value });
  }

  get overrideSelectAllBehaviour() {
    return this.values.selectAll;
  }

  set overrideSelectAllBehaviour(value: boolean) {
    this.update({ selectAll: value });
  }

  get betterListsStyles() {
    return this.values.styleLists;
  }

  set betterListsStyles(value: boolean) {
    this.update({ styleLists: value });
  }

  get verticalLines() {
    return this.values.listLines;
  }

  set verticalLines(value: boolean) {
    this.update({ listLines: value });
  }

  get outerVerticalLines() {
    return this.values.outerListLines;
  }

  set outerVerticalLines(value: boolean) {
    this.update({ outerListLines: value });
  }

  get verticalLinesAction() {
    return this.values.listLineAction;
  }

  set verticalLinesAction(value: VerticalLinesAction) {
    this.update({ listLineAction: value });
  }

  get dragAndDrop() {
    return this.values.dnd;
  }

  set dragAndDrop(value: boolean) {
    this.update({ dnd: value });
  }

  get debug() {
    return this.values.debug;
  }

  set debug(value: boolean) {
    this.update({ debug: value });
  }

  onChange(keys: readonly SettingsKey[], callback: Callback): void {
    this.subscriptions.set(callback, {
      keys: new Set(keys),
      callback,
    });
  }

  removeCallback(callback: Callback): void {
    this.subscriptions.delete(callback);
  }

  reset() {
    this.update(DEFAULT_SETTINGS);
  }

  async load() {
    this.values = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.storage.loadData(),
    );
  }

  async save() {
    await this.storage.saveData(this.values);
  }

  getValues(): SettingsObject {
    return { ...this.values };
  }

  setValue<T extends keyof SettingsObject>(
    key: T,
    value: SettingsObject[T],
  ): void {
    this.update({ [key]: value } as Pick<SettingsObject, T>);
  }

  private assign<T extends SettingsKey>(
    key: T,
    value: SettingsObject[T],
    changed: Set<SettingsKey>,
  ): void {
    if (!Object.is(this.values[key], value)) {
      this.values[key] = value;
      changed.add(key);
    }
  }

  private update(patch: Partial<SettingsObject>): void {
    const changed = new Set<SettingsKey>();
    for (const key of Object.keys(patch) as SettingsKey[]) {
      const value = patch[key];
      if (value !== undefined) {
        this.assign(key, value, changed);
      }
    }

    if (changed.size > 0) {
      this.notify(changed);
    }
  }

  private notify(keys: ReadonlySet<SettingsKey>): void {
    const change: SettingsChange = { keys };
    for (const subscription of this.subscriptions.values()) {
      if ([...keys].some((key) => subscription.keys.has(key))) {
        subscription.callback(change);
      }
    }
  }
}
