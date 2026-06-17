async function loadWorkStatus() {
  const response = await fetch("/api/work-status");
  const data = await response.json();

  document.getElementById("totalCount").textContent = data.total_count;
  document.getElementById("supplementCount").textContent = data.supplement_count;
  document.getElementById("completeCount").textContent = data.complete_count;
}

loadWorkStatus();
