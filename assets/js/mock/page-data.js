// Mock response data for GET /pages/{pageKey}; used when APP_CONFIG.USE_MOCK = true.
const MOCK_PAGE_DATA = {
  dashboard: {
    kpiGroups: [
      {
        target: "kpi-dashboard-overview",
        items: [
          { label: "Today's Energy Consumption", value: "184.6 kWh", note: "↓ 12.7% vs baseline 211.4 kWh", noteClass: "text-teal-600" },
          { label: "Current Active Demand", value: "18.4 kW", note: "Daily peak 26.8 kW", noteClass: "text-teal-600" },
          { label: "Building Occupancy", value: "86 / 120 occupants", note: "71.7% capacity · 6 active zones", noteClass: "text-teal-600" },
          { label: "Comfort Satisfaction", value: "87 %", note: "48 daily responses · thermal & visual", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  indoor: {
    kpiGroups: [
      {
        target: "kpi-indoor-main",
        items: [
          { label: "Average Temperature", value: "24.6 °C", note: "Target 24–26 °C · all zones", noteClass: "text-emerald-500" },
          { label: "Relative Humidity", value: "56 %RH", note: "Within 40–60 %RH nominal range", noteClass: "text-emerald-500" },
          { label: "Average CO₂ Level", value: "810 ppm", note: "Lab B: 1,040 ppm · review ventilation", noteClass: "text-amber-600" },
          { label: "Workplane Illuminance", value: "458 lux", note: "Task target 350–550 lux", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  outdoor: {
    kpiGroups: [
      {
        target: "kpi-outdoor-main",
        items: [
          { label: "Outdoor Temperature", value: "31.2 °C", note: "+6.6 °C vs indoor average", noteClass: "text-teal-600" },
          { label: "Outdoor Humidity", value: "64 %RH", note: "Daily average 69 %RH", noteClass: "text-teal-600" },
          { label: "Solar Irradiance", value: "620 W/m²", note: "Demo telemetry · backup sensor", noteClass: "text-amber-600" },
          { label: "Wind Velocity", value: "2.4 m/s", note: "Southeast heading · 135°", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  occupancy: {
    kpiGroups: [
      {
        target: "kpi-occupancy-main",
        items: [
          { label: "Real-Time Occupancy", value: "23 occupants", note: "Peak today: 28 occupants", noteClass: "text-teal-600" },
          { label: "Average Metabolic Rate", value: "1.2 met", note: "Dominant: seated / typing", noteClass: "text-teal-600" },
          { label: "Average Clothing Insulation", value: "0.6 clo", note: "Observed range 0.4–0.8 clo", noteClass: "text-teal-600" },
          { label: "Last Motion Event", value: "14:30:12", note: "PIR-1 sensor · Lab A", noteClass: "text-slate-500" }
        ]
      }
    ]
  },

  energy: {
    kpiGroups: [
      {
        target: "kpi-energy-main",
        items: [
          { label: "Today's Consumption", value: "184.6 kWh", note: "↓ 12.7% vs baseline 211.4 kWh", noteClass: "text-teal-600" },
          { label: "Active Demand Power", value: "18.4 kW", note: "Peak demand 26.8 kW · 10:30", noteClass: "text-teal-600" },
          { label: "Estimated Daily Cost", value: "Rp 266,062", note: "Tariff benchmark Rp 1,441.70 / kWh", noteClass: "text-teal-600" },
          { label: "Carbon Emissions", value: "156.9 kgCO₂e", note: "Factor: 0.85 kgCO₂e / kWh", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "ac-control": {
    kpiGroups: [
      {
        target: "kpi-ac-main",
        items: [
          { label: "Active HVAC Units", value: "6 / 8 units", note: "2 standby · 0 faults detected", noteClass: "text-teal-600" },
          { label: "HVAC Demand Power", value: "11.2 kW", note: "60.9% of building demand", noteClass: "text-teal-600" },
          { label: "Average Setpoint", value: "24.8 °C", note: "Safe range 23–27 °C", noteClass: "text-teal-600" },
          { label: "Zone Temperature", value: "24.6 °C", note: "Mean deviation -0.2 °C", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "lighting-control": {
    kpiGroups: [
      {
        target: "kpi-light-main",
        items: [
          { label: "Active Fixtures", value: "42 / 48", note: "6 dimmed / standby · 6 zones", noteClass: "text-teal-600" },
          { label: "Lighting Demand", value: "3.8 kW", note: "Today's energy 38.2 kWh", noteClass: "text-teal-600" },
          { label: "Average Illuminance", value: "458 lux", note: "Task target 350–550 lux", noteClass: "text-teal-600" },
          { label: "Average Dimming", value: "68 %", note: "Daylight harvesting: active", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  prediction: {
    kpiGroups: [
      {
        target: "kpi-prediction-main",
        items: [
          { label: "Daily Energy Forecast", value: "258.4 kWh", note: "Actual 184.6 + forecast 73.8 kWh", noteClass: "text-teal-600" },
          { label: "Indoor Temp (+1 Hour)", value: "24.8 °C", note: "95% CI: 24.4–25.2 °C", noteClass: "text-teal-600" },
          { label: "Energy Forecast MAPE", value: "6.2 %", note: "Validation benchmark · last 7 days", noteClass: "text-teal-600" },
          { label: "Prediction Horizon", value: "6 Hours", note: "15-minute sampling resolution", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  moga: {
    kpiGroups: [
      {
        target: "kpi-moga-main",
        items: [
          { label: "Selected Solution Energy", value: "246.0 kWh/day", note: "↓ 4.8% vs forecast 258.4", noteClass: "text-teal-600" },
          { label: "Selected Solution PPD", value: "7.8 %", note: "Complies with comfort limit < 10%", noteClass: "text-teal-600" },
          { label: "Non-Dominated Solutions", value: "18 solutions", note: "Pareto archive · run MOGA-024", noteClass: "text-teal-600" },
          { label: "Generations Completed", value: "100 / 100", note: "8,000 evaluations · 42s", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  mopso: {
    kpiGroups: [
      {
        target: "kpi-mopso-main",
        items: [
          { label: "Selected Solution Energy", value: "241.0 kWh/day", note: "↓ 6.7% vs forecast 258.4", noteClass: "text-teal-600" },
          { label: "Selected Solution PPD", value: "8.2 %", note: "Complies with comfort limit < 10%", noteClass: "text-teal-600" },
          { label: "Repository Solutions", value: "22 solutions", note: "Non-dominated · run MOPSO-018", noteClass: "text-teal-600" },
          { label: "Iterations Completed", value: "120 / 120", note: "7,200 evaluations · 36s", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "comfort-feedback": {
    kpiGroups: [
      {
        target: "kpi-comfort-main",
        items: [
          { label: "Today's Feedback Count", value: "48 responses", note: "6 zones · anonymous feedback", noteClass: "text-teal-600" },
          { label: "Thermal Satisfaction", value: "85 %", note: "41 of 48 within comfort band", noteClass: "text-teal-600" },
          { label: "Visual Satisfaction", value: "90 %", note: "43 of 48 reported comfortable", noteClass: "text-teal-600" },
          { label: "Combined Comfort Index", value: "87 %", note: "Weighted: 60% thermal · 40% visual", noteClass: "text-teal-600" }
        ]
      }
    ]
  },

  "thermal-evaluation": {
    kpiGroups: [
      {
        target: "kpi-thermal-main",
        items: [
          { label: "Average PMV Index", value: "+0.18", note: "Neutral · target range −0.5 to +0.5", noteClass: "text-teal-600" },
          { label: "Average PPD", value: "5.7 %", note: "Below 10% benchmark limit", noteClass: "text-teal-600" },
          { label: "Mean Radiant Temp (MRT)", value: "25.1 °C", note: "Globe thermometer estimate", noteClass: "text-teal-600" },
          { label: "Compliant Zones", value: "6 / 6 zones", note: "Lounge using 14:00 sample", noteClass: "text-amber-400" }
        ]
      }
    ]
  },

  historical: {
    kpiGroups: [
      {
        target: "kpi-historical-main",
        items: [
          { label: "Total Energy Consumption", value: "1,742.8 kWh", note: "Current period partial to 14:30", noteClass: "text-teal-600" },
          { label: "Period Peak Demand", value: "31.6 kW", note: "Sep 30, 2026 · 10:45", noteClass: "text-teal-600" },
          { label: "Average Indoor Temp", value: "24.7 °C", note: "Min 23.8 °C · Max 26.2 °C", noteClass: "text-teal-600" },
          { label: "Data Completeness", value: "99.2 %", note: "3,774 / 3,804 valid samples", noteClass: "text-teal-600" }
        ]
      }
    ]
  }
};
