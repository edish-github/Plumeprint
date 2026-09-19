/** Static export: the whole site is files, so nothing can fail at request time.
 *  The one dynamic route (/api/investigate) is added separately when a key is present. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
