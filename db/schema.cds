/**
 * IoT Fleet Monitoring Data Model
 * SAP CAP Core Data Services Schema
 * Covers: Devices -> Telemetry -> Alerts -> WorkOrders -> Technicians
 */

namespace fleet;

// ─────────────────────────────────────────────
// MASTER DATA
// ─────────────────────────────────────────────

/** Vehicle / Device managed in the fleet */
entity Devices {
  key ID            : UUID;
      deviceId      : String(50) not null;   // human-friendly device identifier
      name          : String(100);
      model         : String(50);
      vin           : String(50);
      lastSeen      : Timestamp;
      status        : String(20) default 'Active';
      createdAt     : Timestamp @cds.on.insert: $now;
}

/** Technicians who can be assigned to work orders */
entity Technicians {
  key ID            : UUID;
      name          : String(100);
      phone         : String(20);
      email         : String(100);
      isActive      : Boolean default true;
}

// ─────────────────────────────────────────────
// TELEMETRY & ALERTS
// ─────────────────────────────────────────────

/** Raw telemetry events reported by devices */
entity Telemetry {
  key ID            : UUID;
      device         : Association to Devices not null;
      recordedAt     : Timestamp @cds.on.insert: $now;
      metric         : String(50);   // e.g., 'battery', 'engine_temp'
      value          : Decimal(18,4);
      unit           : String(10);
      isAlert        : Boolean default false; // set when value exceeds thresholds
}

/** Alerts generated from telemetry */
entity Alerts {
  key ID            : UUID;
      telemetry      : Association to Telemetry not null;
      device         : Association to Devices not null;
      severity       : String(10) default 'medium';
      description    : String(500);
      isAlert        : Boolean default true;
      createdAt      : Timestamp @cds.on.insert: $now;
}

// ─────────────────────────────────────────────
// WORK ORDERS
// ─────────────────────────────────────────────

/** Work orders created for maintenance tasks */
entity WorkOrders {
  key ID            : UUID;
      workNo        : String(20);
      device        : Association to Devices not null;
      alert         : Association to Alerts;
      assignedTo    : Association to Technicians;
      status        : String(20) enum { Open = 'Open'; Assigned = 'Assigned'; Completed = 'Completed'; Cancelled = 'Cancelled'; } default 'Open';
      description   : String(1000);
      createdAt     : Timestamp @cds.on.insert: $now;
      closedAt      : Timestamp;
}
