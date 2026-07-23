declare module "heic-convert" {
  type ConvertOptions = {
    buffer: Buffer;
    format: "JPEG";
    quality: number;
  };

  export default function convert(options: ConvertOptions): Promise<Buffer | ArrayBuffer | Uint8Array>;
}
