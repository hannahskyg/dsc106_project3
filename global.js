const width = 1300;
const height = 700;

// Create SVG element and append to #viz
const svg = d3.select("#viz")
  .append("svg")
  .attr("width", width)
  .attr("height", height);

const projection = d3.geoNaturalEarth1()
  .scale(width / 6.2)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

// Create slider container
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

// Store world data globally to avoid reloading
let worldData = null;

// Function to load and visualize data for a specific year
function visualizeYear(year) {
  yearDisplay.text(year);
  
  // Clear existing visualization
  svg.selectAll("*").remove();
  
  const dataPromise = d3.csv(`processed/pr_by_year/pr_${year}_win5.csv`);
  const worldPromise = worldData 
    ? Promise.resolve(worldData)
    : d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json");
  
  Promise.all([dataPromise, worldPromise])
    .then(([data, world]) => {
      // Store world data for reuse
      if (!worldData) worldData = world;
      
      console.log(`Data loaded for ${year}:`, data.length, "rows");

      // Normalize longitude and convert types
      data.forEach(d => {
        d.lon = ((+d.lon + 180) % 360) - 180;
        d.lat = +d.lat;
        d.pr = +d.pr_total_mm;
      });

      // OPTIMIZATION 1: Use a Map for O(1) lookups instead of array.find()
      const dataMap = new Map();
      data.forEach(d => {
        dataMap.set(`${d.lat},${d.lon}`, d.pr);
      });

      const uniqueLats = [...new Set(data.map(d => d.lat))].sort((a,b)=>b-a);
      const uniqueLons = [...new Set(data.map(d => d.lon))].sort((a,b)=>a-b);

      // OPTIMIZATION 2: Build grid using Map lookup
      const grid = uniqueLats.map(lat =>
        uniqueLons.map(lon => {
          const val = dataMap.get(`${lat},${lon}`);
          return val !== undefined ? val : NaN;
        })
      );

      const scale = d3.scaleSequential(d3.interpolateTurbo)
        .domain(d3.extent(data, d => d.pr));

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      canvas.width = width;
      canvas.height = height;

      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, width, height);

      // OPTIMIZATION 3: Batch canvas operations and pre-compute colors
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

      // OPTIMIZATION 4: Draw all rectangles in a single pass
      rectangles.forEach(rect => {
        ctx.fillStyle = rect.color;
        ctx.fillRect(rect.x, rect.y, 11, 11);
      });

      // OPTIMIZATION 5: Use requestAnimationFrame for smooth rendering
      requestAnimationFrame(() => {
        svg.append("image")
          .attr("href", canvas.toDataURL())
          .attr("width", width)
          .attr("height", height);

        svg.append("path")
          .datum(topojson.feature(world, world.objects.countries))
          .attr("d", path)
          .attr("fill", "none")
          .attr("stroke", "#111")
          .attr("stroke-width", 0.4);

        // Add title
        svg.append("text")
          .attr("x", width / 2)
          .attr("y", 30)
          .attr("text-anchor", "middle")
          .attr("font-size", "24px")
          .attr("font-weight", "bold")
          .attr("fill", "#333")
          .text(`Global Precipitation - ${year} (mm)`);

        // Create color legend
        const legendWidth = 300;
        const legendHeight = 15;
        const legendX = width - legendWidth - 50;
        const legendY = height - 30;

        const defs = svg.append("defs");
        const linearGradient = defs.append("linearGradient")
          .attr("id", "legend-gradient")
          .attr("x1", "0%")
          .attr("x2", "100%");

        const numStops = 10;
        for (let i = 0; i <= numStops; i++) {
          const offset = (i / numStops) * 100;
          const value = scale.domain()[0] + (i / numStops) * (scale.domain()[1] - scale.domain()[0]);
          linearGradient.append("stop")
            .attr("offset", `${offset}%`)
            .attr("stop-color", scale(value));
        }

        svg.append("rect")
          .attr("x", legendX)
          .attr("y", legendY)
          .attr("width", legendWidth)
          .attr("height", legendHeight)
          .style("fill", "url(#legend-gradient)")
          .style("stroke", "#333")
          .style("stroke-width", 1);

        const [minVal, maxVal] = scale.domain();
        
        svg.append("text")
          .attr("x", legendX)
          .attr("y", legendY - 5)
          .attr("font-size", "12px")
          .attr("fill", "#333")
          .text(`${minVal.toFixed(1)} mm`);

        svg.append("text")
          .attr("x", legendX + legendWidth)
          .attr("y", legendY - 5)
          .attr("text-anchor", "end")
          .attr("font-size", "12px")
          .attr("fill", "#333")
          .text(`${maxVal.toFixed(1)} mm`);

        svg.append("text")
          .attr("x", legendX + legendWidth / 2)
          .attr("y", legendY + legendHeight + 15)
          .attr("text-anchor", "middle")
          .attr("font-size", "13px")
          .attr("font-weight", "bold")
          .attr("fill", "#333")
          .text("Total Precipitation");

        console.log(`Visualization complete for ${year}!`);
      });

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

// Event listener for slider
slider.on("input", function() {
  const year = +this.value;
  visualizeYear(year);
});

// Initialize with 1954
visualizeYear(1954);