declare module "compression" {
  const compression: (options?: { threshold?: number | string }) => import("express").RequestHandler;
  export default compression;
}
