/**
 * Fleet OData Service Definition
 * Exposes fleet entities and defines business action endpoints.
 */

using fleet from '../db/schema';

service FleetService @(path: '/api/fleet') {

  // ── Master Data ──────────────────────────────────────────────────────────

  entity Devices      as projection on fleet.Devices;
  entity Technicians  as projection on fleet.Technicians;

  // ── Transactional Entities ────────────────────────────────────────────────

  entity Telemetry    as projection on fleet.Telemetry;
  entity Alerts       as projection on fleet.Alerts;
  entity WorkOrders   as projection on fleet.WorkOrders
    actions {
      /** Assign a work order to a technician */
      action assignWorkOrder(technicianID: UUID) returns WorkOrders;

      /** Mark a work order completed */
      action completeWorkOrder() returns WorkOrders;
    };

  // ── Unbound Business Process Actions ─────────────────────────────────────

  /** Register a new device in the fleet */
  action registerDevice(
    deviceId : String,
    name     : String,
    model    : String
  ) returns Devices;

  /** Ingest raw telemetry from a device (unbound event) */
  action ingestTelemetry(
    deviceID : String,
    metric   : String,
    value    : Decimal,
    unit     : String
  ) returns Telemetry;

  /** Create a work order from an alert (unbound) */
  action createWorkOrder(
    alertID   : UUID,
    description: String
  ) returns WorkOrders;


  // ── Analytics Queries ─────────────────────────────────────────────────────

  /** Summary view for dashboard */
  function getOrderSummary() returns array of {
    status       : String;
    count        : Integer;
    totalRevenue : Decimal;
  };
}
