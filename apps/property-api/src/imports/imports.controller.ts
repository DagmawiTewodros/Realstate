import { Body, Controller, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { AppError, CurrentUser, Roles, toCsv, zod, type AuthUser } from "@platform/nest-common";
import { IMPORTERS } from "../access";
import { IMPORT_FIELDS, IMPORT_KINDS, ImportsService, type ImportKind, type Mapping } from "./imports.service";
import { IMPORT_MAX_BYTES, parseSheet } from "./parse";

const kindSchema = z.enum(IMPORT_KINDS);
const runBody = z.object({ mapping: z.string().min(2).max(10_000) });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });

function parseMapping(raw: string): Mapping {
  try {
    const value = JSON.parse(raw) as unknown;
    return z.record(z.string(), z.string()).parse(value);
  } catch {
    throw new AppError(400, "INVALID_MAPPING", "The column mapping is not valid JSON");
  }
}

/**
 * Two-step imports: preview (columns and suggested mapping), dry run (row-by-row results, nothing saved),
 * then commit (only valid rows are applied). Same file twice updates rather than duplicates.
 */
@Controller("imports")
@Roles(...IMPORTERS)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post(":kind/preview")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMPORT_MAX_BYTES } }))
  async preview(@Param("kind") kindRaw: string, @UploadedFile() file: Express.Multer.File) {
    const kind = kindSchema.parse(kindRaw);
    const sheet = await parseSheet(file);
    return {
      columns: sheet.columns,
      sample: sheet.rows.slice(0, 5),
      rowCount: sheet.rows.length,
      fields: IMPORT_FIELDS[kind].map(({ field, required }) => ({ field, required })),
      suggestedMapping: await this.imports.suggestMapping(kind, sheet.columns),
    };
  }

  @Post(":kind/dry-run")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMPORT_MAX_BYTES } }))
  async dryRun(
    @CurrentUser() user: AuthUser,
    @Param("kind") kindRaw: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(zod(runBody)) body: z.infer<typeof runBody>,
    @Query(zod(formatQuery)) q: z.infer<typeof formatQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.execute(user, kindSchema.parse(kindRaw), file, body.mapping, false), q.format, res);
  }

  @Post(":kind/commit")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: IMPORT_MAX_BYTES } }))
  async commit(
    @CurrentUser() user: AuthUser,
    @Param("kind") kindRaw: string,
    @UploadedFile() file: Express.Multer.File,
    @Body(zod(runBody)) body: z.infer<typeof runBody>,
    @Query(zod(formatQuery)) q: z.infer<typeof formatQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.execute(user, kindSchema.parse(kindRaw), file, body.mapping, true), q.format, res);
  }

  private async execute(user: AuthUser, kind: ImportKind, file: Express.Multer.File, mappingRaw: string, commit: boolean) {
    const sheet = await parseSheet(file);
    return this.imports.run(user, kind, sheet, parseMapping(mappingRaw), commit);
  }

  private respond(result: Awaited<ReturnType<ImportsService["run"]>>, format: "json" | "csv", res: Response) {
    if (format === "json") return result;
    const csv = toCsv(
      ["Row", "Result", "Key", "Reason", "Warning"],
      result.results.map((r) => [r.row, r.outcome, r.key ?? "", r.reason ?? "", r.warning ?? ""]),
    );
    // With passthrough responses Nest sends the returned value, so set the headers and return the text.
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="import-report-${result.commit ? "commit" : "dry-run"}.csv"`);
    return csv;
  }
}
