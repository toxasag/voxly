// Voxly Robokassa billing client
// Handles payment URL generation, webhook signature verification, fiscal receipts (54-ФЗ)

import { createHash } from 'node:crypto';

export interface RobokassaConfig {
  merchantLogin: string;
  password1: string;
  password2: string;
  isTest: boolean;
}

export interface CheckoutItem {
  name: string;
  quantity: number;
  price: number;
  tax: 'none' | 'vat0' | 'vat10' | 'vat20';
  paymentMethod: 'full' | 'partial' | 'prepayment';
  paymentObject: 'service' | 'commodity' | 'intellectual';
}

export interface CheckoutParams {
  invId: number;
  amount: number;
  description: string;
  email?: string;
  items: CheckoutItem[];
  customData?: Record<string, string>; // shp_* parameters
}

export class RobokassaClient {
  private readonly config: RobokassaConfig;
  private readonly baseUrl = 'https://auth.robokassa.ru/Merchant/Index.aspx';

  constructor(config: RobokassaConfig) {
    this.config = config;
  }

  /**
   * Generate payment URL for redirect
   */
  generatePaymentUrl(params: CheckoutParams): string {
    const shpSuffix = this.buildShpSuffix(params.customData);
    const signature = this.computeSignature(
      params.amount,
      params.invId,
      this.config.password1,
      shpSuffix,
    );

    const url = new URL(this.baseUrl);
    url.searchParams.set('MerchantLogin', this.config.merchantLogin);
    url.searchParams.set('OutSum', params.amount.toFixed(2));
    url.searchParams.set('InvId', String(params.invId));
    url.searchParams.set('Description', params.description);
    url.searchParams.set('SignatureValue', signature);

    if (params.email) {
      url.searchParams.set('Email', params.email);
    }

    if (this.config.isTest) {
      url.searchParams.set('IsTest', '1');
    }

    // Fiscal receipt data (54-ФЗ)
    const receipt = this.buildReceipt(params.items, params.email);
    if (receipt) {
      url.searchParams.set('Receipt', JSON.stringify(receipt));
      // For fiscal receipts, signature includes receipt JSON before shp
      const fiscalSig = this.computeFiscalSignature(
        params.amount,
        params.invId,
        JSON.stringify(receipt),
        this.config.password1,
        shpSuffix,
      );
      url.searchParams.set('SignatureValue', fiscalSig);
    }

    // Append shp_* params
    if (params.customData) {
      for (const [key, value] of Object.entries(params.customData)) {
        url.searchParams.set(`shp_${key}`, value);
      }
    }

    return url.toString();
  }

  /**
   * Verify Result URL webhook signature (Password #2)
   * Robokassa sends: OutSum, InvId, SignatureValue, shp_*
   */
  verifyResultSignature(params: {
    outSum: string;
    invId: string;
    signatureValue: string;
    customData?: Record<string, string>;
  }): boolean {
    const shpSuffix = this.buildShpSuffix(params.customData);
    const expected = this.computeSignature(
      parseFloat(params.outSum),
      parseInt(params.invId, 10),
      this.config.password2,
      shpSuffix,
    );
    return this.safeCompare(expected, params.signatureValue.toLowerCase());
  }

  /**
   * Verify Success URL redirect signature (Password #1)
   */
  verifySuccessSignature(params: {
    outSum: string;
    invId: string;
    signatureValue: string;
    customData?: Record<string, string>;
  }): boolean {
    const shpSuffix = this.buildShpSuffix(params.customData);
    const expected = this.computeSignature(
      parseFloat(params.outSum),
      parseInt(params.invId, 10),
      this.config.password1,
      shpSuffix,
    );
    return this.safeCompare(expected, params.signatureValue.toLowerCase());
  }

  private computeSignature(
    amount: number,
    invId: number,
    password: string,
    shpSuffix: string,
  ): string {
    const stringToSign = `${this.config.merchantLogin}:${amount.toFixed(2)}:${invId}:${password}${shpSuffix}`;
    return createHash('sha256').update(stringToSign).digest('hex');
  }

  private computeFiscalSignature(
    amount: number,
    invId: number,
    receiptJson: string,
    password: string,
    shpSuffix: string,
  ): string {
    const stringToSign = `${this.config.merchantLogin}:${amount.toFixed(2)}:${invId}:${receiptJson}:${password}${shpSuffix}`;
    return createHash('sha256').update(stringToSign).digest('hex');
  }

  private buildShpSuffix(customData?: Record<string, string>): string {
    if (!customData || Object.keys(customData).length === 0) return '';
    return Object.keys(customData)
      .sort()
      .map((k) => `:shp_${k}=${customData[k]}`)
      .join('');
  }

  private buildReceipt(items: CheckoutItem[], email?: string) {
    if (items.length === 0) return null;
    return {
      items: items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        sum: item.price * item.quantity,
        payment_method: item.paymentMethod,
        payment_object: item.paymentObject,
        tax: item.tax,
      })),
      ...(email ? { email } : {}),
    };
  }

  private safeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}

/**
 * Calculate subscription price with period discount
 */
export function calculateSubscriptionPrice(
  monthlyPrice: number,
  periodMonths: number,
  discountPercent: number,
): number {
  const base = monthlyPrice * periodMonths;
  const discount = (base * discountPercent) / 100;
  return Math.round((base - discount) * 100) / 100;
}

/**
 * Calculate prorated seat price for mid-period addition
 */
export function calculateProratedSeatPrice(
  monthlyPrice: number,
  remainingDays: number,
  totalDaysInPeriod: number,
): number {
  return Math.round((monthlyPrice * (remainingDays / totalDaysInPeriod)) * 100) / 100;
}
