// global.js

const width = 1300;
// Taller SVG so we have a clean band for the legend under the map
const height = 820;
const dpr = window.devicePixelRatio || 1;

// Create SVG element and append to #viz
const svg = d3.select("#viz")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

// Move the map up a bit, leaving room at the bottom for the legend
const projection = d3.geoNaturalEarth1()
  .scale(width / 6.2)
  .translate([width / 2, height / 2 - 60]);

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

// Store world data so we only load it once
let worldData = null;

// ----- Main visualization function -----
function visualizeYear(year) {
  yearDisplay.text(year);

  // Clear just the SVG contents; slider lives in a separate <div>
  svg.selectAll("*").remove();

  const dataPromise = d3.csv(`processed/pr_by_year/pr_${year}_win5.csv`);
  const worldPromise = worldData
    ? Promise.resolve(worldData)
    : d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json`);

  Promise.all([dataPromise, worldPromise])
    .then(([data, world]) => {
      if (!worldData) worldData = world;

      // Normalize and convert types
      data.forEach(d => {
        d.lon = ((+d.lon + 180) % 360) - 180;
        d.lat = +d.lat;
        d.pr = +d.pr_total_mm;
      });

      const uniqueLats = [...new Set(data.map(d => d.lat))].sort((a, b) => b - a);
      const uniqueLons = [...new Set(data.map(d => d.lon))].sort((a, b) => a - b);

      // ---- Outlier handling: clamp values to 1st–99th percentile ----
      const prValues = data
        .map(d => d.pr)
        .filter(v => Number.isFinite(v))
        .sort(d3.ascending);

      const lo = d3.quantile(prValues, 0.01);
      const hi = d3.quantile(prValues, 0.99);

      // Map from (lat,lon) to CLAMPED value
      const dataMap = new Map();
      data.forEach(d => {
        const v = Math.max(lo, Math.min(hi, d.pr)); // clamp outliers
        dataMap.set(`${d.lat},${d.lon}`, v);
      });

      const grid = uniqueLats.map(lat =>
        uniqueLons.map(lon => {
          const val = dataMap.get(`${lat},${lon}`);
          return val !== undefined ? val : NaN;
        })
      );

      // Color scale uses the clamped range
      const scale = d3.scaleSequential(d3.interpolateTurbo)
        .domain([lo, hi]);

      // ----- Hi-DPI canvas for crisp image -----
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);

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
            color
          });
        }
      }

      const cellSize = 11;
      rectangles.forEach(rect => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(rect.x, rect.y, cellSize, cellSize);
      });

      const dataURL = canvas.toDataURL();

      // ----- Draw into SVG -----
      // heatmap image with a quick fade-in
      svg.append("image")
        .attr("href", dataURL)
        .attr("width", width)
        .attr("height", height)
        .attr("opacity", 0)
        .transition()
        .duration(500)
        .attr("opacity", 1);

      // country outlines
      svg.append("path")
        .datum(topojson.feature(worldData, worldData.objects.countries))
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#111")
        .attr("stroke-width", 0.4);

      // title
      svg.append("text")
        .attr("x", width / 2)
        .attr("y", 50)
        .attr("text-anchor", "middle")
        .attr("font-size", "24px")
        .attr("font-weight", "bold")
        .attr("fill", "#333")
        .text(`Global Precipitation (5-year window ending ${year})`);

      // ----- Legend (now in a clear band under the map) -----
      const legendWidth = 320;
      const legendHeight = 16;
      const legendX = (width - legendWidth) / 2;
      const legendY = height - 80;   // lower than before, in white space

      const defs = svg.append("defs");
      const linearGradient = defs.append("linearGradient")
        .attr("id", "legend-gradient")
        .attr("x1", "0%")
        .attr("x2", "100%");

      const numStops = 10;
      for (let i = 0; i <= numStops; i++) {
        const t = i / numStops;
        const value = lo + t * (hi - lo);
        linearGradient.append("stop")
          .attr("offset", `${t * 100}%`)
          .attr("stop-color", scale(value));
      }

      svg.append("rect")
        .attr("x", legendX)
        .attr("y", legendY)
        .attr("width", legendWidth)
        .attr("height", legendHeight)
        .attr("rx", 3)
        .style("fill", "url(#legend-gradient)")
        .style("stroke", "#333")
        .style("stroke-width", 1);

      svg.append("text")
        .attr("x", legendX)
        .attr("y", legendY - 6)
        .attr("font-size", 12)
        .attr("fill", "#333")
        .text(`${lo.toFixed(1)} mm`);

      svg.append("text")
        .attr("x", legendX + legendWidth)
        .attr("y", legendY - 6)
        .attr("text-anchor", "end")
        .attr("font-size", 12)
        .attr("fill", "#333")
        .text(`${hi.toFixed(1)} mm`);

      svg.append("text")
        .attr("x", legendX + legendWidth / 2)
        .attr("y", legendY + legendHeight + 18)
        .attr("text-anchor", "middle")
        .attr("font-size", 13)
        .attr("font-weight", "bold")
        .attr("fill", "#333")
        .text("Total Precipitation (mm)");
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
