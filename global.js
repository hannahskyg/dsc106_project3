// global.js

const width = 1300;
const height = 700;
const dpr = window.devicePixelRatio || 1;

// map area (top margin so title has room, bottom margin for legend)
const mapY = 50;
const mapHeight = height - 120; // from mapY down to ~height-70

// Create SVG element and append to #viz
const svg = d3.select("#viz")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

const projection = d3.geoNaturalEarth1()
  .scale(width / 6.2)
  .translate([width / 2, mapY + mapHeight / 2]); // center of the map band

const path = d3.geoPath(projection);

// ----- Slider UI -----
const sliderContainer = d3.select("#viz")
  .insert("div", "svg")
  .style("text-align", "center")
  .style("margin", "20px 0");

sliderContainer.append("label")
  .style("font-size", "16px")
  .style("font-weight", "bold")
  .style("margin-right", "10px")
  .text("Year: ");

const yearDisplay = sliderContainer.append("span")
  .style("font-size", "18px")
  .style("font-weight", "bold")
  .style("margin-right", "20px")
  .text("1954");

const slider = sliderContainer.append("input")
  .attr("type", "range")
  .attr("min", 1954)
  .attr("max", 2014)
  .attr("value", 1954)
  .attr("step", 1)
  .style("width", "500px")
  .style("vertical-align", "middle");

// ----- Globals so we can REUSE elements (no flashing) -----
let worldData = null;
let rasterImage = null;
let countriesPath = null;
let titleText = null;
let legendGroup = null;
let legendGradient = null;

// ----- Legend helper -----
function updateLegend(scale) {
  const legendWidth = 320;
  const legendHeight = 16;
  const legendX = (width - legendWidth) / 2;
  const legendY = height - 50;  // clearly below map area

  if (!legendGroup) {
    const defs = svg.append("defs");
    legendGradient = defs.append("linearGradient")
      .attr("id", "legend-gradient")
      .attr("x1", "0%")
      .attr("x2", "100%");

    legendGroup = svg.append("g")
      .attr("class", "legend")
      .attr("transform", `translate(${legendX},${legendY})`);

    legendGroup.append("rect")
      .attr("class", "legend-bar")
      .attr("width", legendWidth)
      .attr("height", legendHeight)
      .attr("rx", 3)
      .style("fill", "url(#legend-gradient)")
      .style("stroke", "#333")
      .style("stroke-width", 1);

    legendGroup.append("text")
      .attr("class", "legend-min")
      .attr("x", 0)
      .attr("y", -6)
      .attr("font-size", 12)
      .attr("fill", "#333");

    legendGroup.append("text")
      .attr("class", "legend-max")
      .attr("x", legendWidth)
      .attr("y", -6)
      .attr("text-anchor", "end")
      .attr("font-size", 12)
      .attr("fill", "#333");

    legendGroup.append("text")
      .attr("class", "legend-title")
      .attr("x", legendWidth / 2)
      .attr("y", legendHeight + 18)
      .attr("text-anchor", "middle")
      .attr("font-size", 13)
      .attr("font-weight", "bold")
      .attr("fill", "#333")
      .text("Total Precipitation (mm)");
  }

  legendGradient.selectAll("stop").remove();

  const [minVal, maxVal] = scale.domain();
  const numStops = 10;
  for (let i = 0; i <= numStops; i++) {
    const t = i / numStops;
    const value = minVal + t * (maxVal - minVal);
    legendGradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", scale(value));
  }

  legendGroup.select(".legend-min").text(`${minVal.toFixed(1)} mm`);
  legendGroup.select(".legend-max").text(`${maxVal.toFixed(1)} mm`);
}

// ----- Main visualization function -----
function visualizeYear(year) {
  yearDisplay.text(year);

  const dataPromise = d3.csv(`processed/pr_by_year/pr_${year}_win5.csv`);
  const worldPromise = worldData
    ? Promise.resolve(worldData)
    : d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");

  Promise.all([dataPromise, worldPromise])
    .then(([data, world]) => {
      if (!worldData) worldData = world;

      // convert + normalize lon/lat
      data.forEach(d => {
        d.lon = ((+d.lon + 180) % 360) - 180;
        d.lat = +d.lat;
        d.pr = +d.pr_total_mm;
      });

      const uniqueLats = [...new Set(data.map(d => d.lat))].sort((a, b) => b - a);
      const uniqueLons = [...new Set(data.map(d => d.lon))].sort((a, b) => a - b);

      const dataMap = new Map();
      data.forEach(d => {
        dataMap.set(`${d.lat},${d.lon}`, d.pr);
      });

      const grid = uniqueLats.map(lat =>
        uniqueLons.map(lon => {
          const val = dataMap.get(`${lat},${lon}`);
          return val !== undefined ? val : NaN;
        })
      );

      const scale = d3.scaleSequential(d3.interpolateTurbo)
        .domain(d3.extent(data, d => d.pr));

      // Hi-DPI canvas for crisp image
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = width * dpr;
      canvas.height = mapHeight * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, mapHeight);

      const rectangles = [];
      for (let i = 0; i < uniqueLats.length; i++) {
        for (let j = 0; j < uniqueLons.length; j++) {
          const val = grid[i][j];
          if (isNaN(val)) continue;

          const projected = projection([uniqueLons[j], uniqueLats[i]]);
          if (!projected) continue;

          const [x, y] = projected;
          const color = scale(val);

          rectangles.push({
            x: Math.floor(x),
            y: Math.floor(y),
            color: color
          });
        }
      }

      const cellSize = 11;
      rectangles.forEach(rect => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(rect.x, rect.y - mapY, cellSize, cellSize);
        // subtract mapY so (0,0) in canvas corresponds to top of map band
      });

      const dataURL = canvas.toDataURL();

      // ----- SMOOTH UPDATE: reuse elements instead of clearing SVG -----
      if (!rasterImage) {
        rasterImage = svg.append("image")
          .attr("x", 0)
          .attr("y", mapY)
          .attr("width", width)
          .attr("height", mapHeight)
          .attr("opacity", 0);
      }

      rasterImage
        .transition()
        .duration(600)
        .attr("href", dataURL)
        .attr("opacity", 1);

      if (!countriesPath) {
        countriesPath = svg.append("path")
          .datum(topojson.feature(worldData, worldData.objects.countries))
          .attr("d", path)
          .attr("fill", "none")
          .attr("stroke", "#111")
          .attr("stroke-width", 0.4);
      }

      if (!titleText) {
        titleText = svg.append("text")
          .attr("x", width / 2)
          .attr("y", 30)
          .attr("text-anchor", "middle")
          .attr("font-size", 24)
          .attr("font-weight", "bold")
          .attr("fill", "#333");
      }
      titleText.text(`Global Precipitation (5-year window ending ${year})`);

      updateLegend(scale);
    })
    .catch(error => {
      console.error(`Error loading data for ${year}:`, error);
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", height / 2)
        .attr("text-anchor", "middle")
        .style("fill", "red")
        .style("font-size", "16px")
        .text(`Error loading data for ${year}. Check console for details.`);
    });
}

// Slider event
slider.on("input", function () {
  const year = +this.value;
  visualizeYear(year);
});

// Initial render
visualizeYear(1954);
