// Compile-only regression for the semantic driver's public test globals.
// @ts-expect-error listLines accepts only boolean values.
void setSetting({ k: "listLines", v: "toggle-folding" });
