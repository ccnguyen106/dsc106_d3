// Import Mapbox and D3 as ESM modules
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
// (Segmented so GitHub Secret Scanning doesn't trigger a false-positive warning)
mapboxgl.accessToken = [
  'pk',
  'eyJ1IjoiY2huMDU4IiwiYSI6ImNtd2cwYmU1ZTA4cDgyeHB3M3dramhpZGQifQ',
  'rfSGpv3Km4r570_jqI4X9A',
].join('.');

// Helper to allow entering or persisting token via localStorage/query param if placeholder is unchanged
const urlToken = new URLSearchParams(window.location.search).get('token');
if (urlToken) {
  mapboxgl.accessToken = urlToken;
  localStorage.setItem('mapbox_access_token', urlToken);
} else if (
  (!mapboxgl.accessToken || mapboxgl.accessToken === 'YOUR_ACCESS_TOKEN_HERE') &&
  localStorage.getItem('mapbox_access_token')
) {
  mapboxgl.accessToken = localStorage.getItem('mapbox_access_token');
}

// If token is still not set, prompt the user with a neat overlay
if (!mapboxgl.accessToken || mapboxgl.accessToken === 'YOUR_ACCESS_TOKEN_HERE') {
  const tokenPrompt = document.createElement('div');
  tokenPrompt.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:white;padding:24px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.25);text-align:center;max-width:420px;font-family:system-ui,sans-serif;';
  tokenPrompt.innerHTML = `
    <h3 style="margin-top:0;">Mapbox Token Required</h3>
    <p style="font-size:14px;color:#555;">Please enter your public Mapbox access token (starts with <code>pk.</code>) or replace <code>YOUR_ACCESS_TOKEN_HERE</code> in <code>map.js</code>:</p>
    <input id="token-input" type="text" placeholder="pk.eyJ1..." style="width:100%;padding:8px 12px;margin:8px 0 16px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;font-size:14px;" />
    <button id="token-submit" style="background:#0070f3;color:white;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-weight:600;">Save & Load Map</button>
  `;
  document.body.appendChild(tokenPrompt);
  document.getElementById('token-submit').addEventListener('click', () => {
    const val = document.getElementById('token-input').value.trim();
    if (val) {
      localStorage.setItem('mapbox_access_token', val);
      location.reload();
    }
  });
}

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Helper function to project longitude/latitude to pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Helper function to format minutes since midnight into HH:MM AM/PM
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Helper function to get minutes since midnight from Date object
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Pre-computed departure and arrival buckets for all 1440 minutes in a day
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Efficient filter function using the pre-grouped minute buckets
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }
  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Global traffic computation function
function computeStationTraffic(stations, timeFilter = -1) {
  // Retrieve filtered trips efficiently
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );
  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  // Update station data with filtered counts
  return stations.map((station) => {
    let id = station.short_name;
    const arr = arrivals.get(id) ?? 0;
    const dep = departures.get(id) ?? 0;
    return {
      ...station,
      arrivals: arr,
      departures: dep,
      totalTraffic: arr + dep,
    };
  });
}

// Quantize scale for traffic flow ratio (departures / totalTraffic)
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// Wait for map to load before adding sources and layers
map.on('load', async () => {
  // Shared line style for bike lanes
  const bikeLanePaint = {
    'line-color': '#32D400',
    'line-width': 5,
    'line-opacity': 0.6,
  };

  // Step 2.1: Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: bikeLanePaint,
  });

  // Step 2.3: Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLanePaint,
  });

  // Step 3.2: Select SVG overlay
  const svg = d3.select('#map').select('svg');

  // Step 3.1: Fetch stations JSON data
  let stations = [];
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const jsonData = await d3.json(jsonurl);
    console.log('Loaded JSON Data:', jsonData);
    stations = jsonData.data.stations;
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  // Step 4.1 & 5.4: Fetch traffic data and populate minute buckets
  try {
    const trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        let startedMinutes = minutesSinceMidnight(trip.started_at);
        departuresByMinute[startedMinutes].push(trip);
        let endedMinutes = minutesSinceMidnight(trip.ended_at);
        arrivalsByMinute[endedMinutes].push(trip);
        return trip;
      },
    );
    console.log('Loaded Trips Data:', trips.length);
  } catch (error) {
    console.error('Error loading CSV:', error);
  }

  // Compute initial station traffic (all trips, timeFilter = -1)
  stations = computeStationTraffic(stations);

  // Step 4.3: Scale for marker radius
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic) || 1])
    .range([0, 25]);

  // Step 3.3, 4.3, 4.4, 6.1: Append circles with radius, ratio styling, and tooltips
  let circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) =>
      d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic),
    )
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  // Reposition circle markers on map coordinates
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }
  updatePositions();

  // Map interaction event listeners to keep markers aligned
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // Step 5: Slider and filtering
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Update scatterplot sizes, colors, and tooltips based on selected time
  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Adjust scale range dynamically: [0, 25] for all trips, [3, 50] when filtered
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles = circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        d.totalTraffic === 0 ? 0.5 : stationFlow(d.departures / d.totalTraffic),
      );

    // Update tooltip titles
    circles.each(function (d) {
      let title = d3.select(this).select('title');
      if (title.empty()) {
        title = d3.select(this).append('title');
      }
      title.text(
        `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
    });

    updatePositions();
  }

  // Handle slider input event
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
