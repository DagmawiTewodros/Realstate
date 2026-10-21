import { PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, z } from "zod";

/** Validates and transforms a request body or query with a shared Zod schema. Errors become 400 VALIDATION_FAILED. */
export class ZodPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}
  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value ?? {});
  }
}

export const zod = <S extends ZodTypeAny>(schema: S) => new ZodPipe(schema);
