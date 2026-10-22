declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    type?: string;
    margin?: number;
    width?: number;
    scale?: number;
    color?: {
      dark?: string;
      light?: string;
    };
  }

  export function toDataURL(
    text: string | Buffer,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;

  export function toString(
    text: string | Buffer,
    options?: { type?: "svg" | "utf8" | "terminal" },
  ): Promise<string>;
}
