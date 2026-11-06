-- Migration 0073: Clean default/demo seed data from service center dictionaries
-- User populates dictionaries manually via intake UI

DELETE FROM equipment_types;
DELETE FROM equipment_brands;
DELETE FROM equipment_models;
DELETE FROM equipment_accessories;
DELETE FROM equipment_malfunctions;
