import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GeoEnrichmentService,
  isPrivateIp,
  cleanIpAddress,
} from "../dist/services/geo-enrichment.service.js";

test("isPrivateIp: correctly identifies private and loopback IPs", () => {
  assert.equal(isPrivateIp("127.0.0.1"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("localhost"), true);
  assert.equal(isPrivateIp("10.0.1.5"), true);
  assert.equal(isPrivateIp("192.168.1.1"), true);
  assert.equal(isPrivateIp("172.16.0.1"), true);
  assert.equal(isPrivateIp("172.31.255.255"), true);
  assert.equal(isPrivateIp("172.32.0.1"), false);
  assert.equal(isPrivateIp("8.8.8.8"), false);
  assert.equal(isPrivateIp("212.45.1.1"), false);
  assert.equal(isPrivateIp("150.241.98.135"), false);
});

test("cleanIpAddress: extracts first IP and strips port", () => {
  assert.equal(cleanIpAddress("212.45.1.1:8080"), "212.45.1.1");
  assert.equal(cleanIpAddress("212.45.1.1, 10.0.0.1"), "212.45.1.1");
  assert.equal(cleanIpAddress("  195.16.2.3  "), "195.16.2.3");
  assert.equal(cleanIpAddress(null), null);
  assert.equal(cleanIpAddress(""), null);
});

test("lookupIp: returns local fallback for private IP without network call", async () => {
  const service = new GeoEnrichmentService();
  const res = await service.lookupIp("192.168.1.100");
  assert.notEqual(res, null);
  assert.equal(res?.sourceType, "local");
  assert.equal(res?.city, "Локальный хост");
  assert.equal(res?.countryCode, "LOCAL");
});

test("lookupIp: resolves public IP to city/country and caches result", async () => {
  const service = new GeoEnrichmentService();
  // 212.45.1.1 - Moscow (Comcor)
  const res = await service.lookupIp("212.45.1.1");
  assert.notEqual(res, null);
  assert.equal(res?.sourceType, "ip");
  assert.equal(res?.country, "Россия");
  assert.equal(res?.city, "Москва");
  assert.equal(typeof res?.latitude, "number");
  assert.equal(typeof res?.longitude, "number");

  // Второе обращение должно мгновенно браться из кэша
  const t0 = Date.now();
  const cached = await service.lookupIp("212.45.1.1");
  const elapsed = Date.now() - t0;
  assert.deepEqual(cached, res);
  assert.ok(elapsed < 20, "Кэшированный запрос должен отрабатывать быстрее 20 мс");
});

test("reverseGeocode: reverses GPS coordinates to Russian address via Nominatim", async () => {
  const service = new GeoEnrichmentService();
  // Координаты центра Москвы (Красная площадь)
  const res = await service.reverseGeocode({
    latitude: 55.7558,
    longitude: 37.6173,
    accuracy: 15,
  });

  assert.notEqual(res, null);
  assert.equal(res?.sourceType, "gps");
  assert.equal(res?.accuracy, 15);
  assert.ok(res?.address?.includes("Москва"), "Адрес должен содержать 'Москва'");
  assert.ok(res?.mapUrl?.includes("yandex.ru/maps"), "Ссылка на Яндекс.Карты сформирована");
});

test("enrichLocation: hybrid merge merges GPS coords and IP into one record", async () => {
  const service = new GeoEnrichmentService();
  const res = await service.enrichLocation({
    ip: "212.45.1.1",
    coords: {
      latitude: 55.7558,
      longitude: 37.6173,
      accuracy: 10,
    },
  });

  assert.notEqual(res, null);
  assert.equal(res?.sourceType, "gps");
  assert.equal(res?.ip, "212.45.1.1");
  assert.equal(res?.accuracy, 10);
  assert.ok(res?.address?.includes("Москва"));
  assert.ok(res?.isp, "ISP должен быть обогащен из IP");
});
