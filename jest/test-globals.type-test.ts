import type { SemanticDriverCommandName } from "./semantic-command-contract";
import type { DeclaredSemanticDriverCommandName } from "./test-globals";

// Compile-only regression for the semantic driver's public test globals.
// @ts-expect-error listLines is no longer a supported setting key.
void setSetting({ k: "listLines", v: true });

type Assert<T extends true> = T;
type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;
type IsCallableDriverGlobal<K extends SemanticDriverCommandName> =
  K extends keyof typeof window
    ? (typeof window)[K] extends (...args: never[]) => Promise<unknown>
      ? true
      : false
    : false;
type AllDriverGlobalsAreCallable = {
  [K in SemanticDriverCommandName]: IsCallableDriverGlobal<K>;
}[SemanticDriverCommandName];

type SemanticDriverGlobalsAreComplete = Assert<
  AllDriverGlobalsAreCallable extends true ? true : false
>;
type SemanticDriverGlobalNamesAreExact = Assert<
  IsExact<DeclaredSemanticDriverCommandName, SemanticDriverCommandName>
>;
declare const semanticDriverGlobalsAreComplete: SemanticDriverGlobalsAreComplete;
declare const semanticDriverGlobalNamesAreExact: SemanticDriverGlobalNamesAreExact;
void semanticDriverGlobalsAreComplete;
void semanticDriverGlobalNamesAreExact;
