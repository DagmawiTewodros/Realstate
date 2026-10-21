import type { INestApplication } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { INTERNAL_KEY, PUBLIC_KEY, ROLES_KEY } from "./auth/decorators";

export interface RouteInfo {
  method: string;
  path: string;
  access: "public" | "internal" | "any" | "roles" | "none";
  roles: string[];
}

const joinPath = (...parts: string[]) =>
  `/${parts
    .flatMap((p) => p.split("/"))
    .filter(Boolean)
    .join("/")}`;

/** Lists every route with who may call it. Used by the permission matrix test and docs/PERMISSIONS.md. */
export function collectRoutes(app: INestApplication): RouteInfo[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: RouteInfo[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = (Reflect.getMetadata(PATH_METADATA, metatype) as string | string[] | undefined) ?? "";
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodName] as (...args: unknown[]) => unknown;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (path === undefined || method === undefined) continue;
      const targets = [handler, metatype];
      const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets);
      const isInternal = reflector.getAllAndOverride<boolean>(INTERNAL_KEY, targets);
      const roles = reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets) ?? [];
      const access: RouteInfo["access"] = isInternal ? "internal" : isPublic ? "public" : roles.includes("*") ? "any" : roles.length ? "roles" : "none";
      for (const b of Array.isArray(base) ? base : [base]) {
        for (const p of Array.isArray(path) ? path : [path]) {
          routes.push({ method: RequestMethod[method], path: joinPath(b, p), access, roles: access === "roles" ? [...roles].sort() : [] });
        }
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
