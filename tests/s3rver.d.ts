/** Serveur S3 local utilisé par les tests du pilote de stockage (le paquet ne fournit pas de types). */
declare module "s3rver" {
  export default class S3rver {
    constructor(options: { port: number; address: string; silent: boolean; directory: string; configureBuckets: Array<{ name: string; configs: string[] }> });
    run(): Promise<{ port: number; address: string }>;
    close(): Promise<void>;
  }
}
