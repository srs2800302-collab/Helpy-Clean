// R6's immutable package refers to its original sandbox. Remap only that
// import prefix to this workspace; do not copy or change independent assertions.
import { registerHooks } from 'node:module';

const root = new URL('../../../', import.meta.url);
const prefix = '../f2_final_review_work/';
registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith(prefix) ? new URL(specifier.slice(prefix.length), root).href : specifier, context);
  },
});
