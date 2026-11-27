import type { ToObjectOptions } from 'mongoose';

type Ret = Record<string, unknown>;

function baseTransform(ret: Ret): Ret {
  if (ret._id !== undefined) {
    ret.id = String(ret._id);
    delete ret._id;
  }
  return ret;
}

/**
 * Shared toJSON options: expose `id` instead of `_id`, drop `__v`.
 */
export const toJSONOptions: ToObjectOptions = {
  virtuals: false,
  versionKey: false,
  transform: (_doc, ret) => baseTransform(ret as Ret),
};

/** toJSON options with an extra per-schema transform (e.g. strip secrets, rename fields). */
export function withJSONTransform(extra: (ret: Ret) => void): ToObjectOptions {
  return {
    ...toJSONOptions,
    transform: (_doc, ret) => {
      extra(ret as Ret);
      return baseTransform(ret as Ret);
    },
  };
}
