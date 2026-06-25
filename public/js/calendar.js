// public/js/calendar.js
// Plain JavaScript for Calendar page

let allEvents = [];
let allClients = [];
let allTasks = [];
let deleteId = null;
let currentDate = new Date();
let currentView = 'month';

// Load data on page load
async function initCalendar() {
  await Promise.all([loadClients(), loadTasks()]);
  await loadEvents();
  renderCalendar();
}

async function loadClients() {
  const res = await fetch('/api/clients');
  allClients = await res.json();
  
  // Populate client filter
  const filterSelect = document.getElementById('filter-client');
  filterSelect.innerHTML = '<option value="">All Clients</option>';
  allClients.forEach(client => {
    filterSelect.innerHTML += `<option value="${client.id}">${escapeHtml(client.name)}</option>`;
  });
}

async function loadTasks() {
  const res = await fetch('/api/work-items');
  allTasks = await res.json();
  
  // Populate work item select in modal
  const workItemSelect = document.getElementById('f-work-item');
  workItemSelect.innerHTML = '<option value="">No link</option>';
  allTasks.forEach(task => {
    workItemSelect.innerHTML += `<option value="${task.id}">${escapeHtml(task.title)} (${escapeHtml(task.client_name || 'No Client')})</option>`;
  });
}

async function loadEvents() {
  const clientId = document.getElementById('filter-client').value;
  let url = '/api/calendar-events?user_id=1'; // Default user_id=1 for now (no auth)
  
  if (clientId) {
    // Get tasks for this client first, then filter events
    const taskRes = await fetch(`/api/work-items?client_id=${clientId}`);
    const clientTasks = await taskRes.json();
    const taskIds = clientTasks.map(t => t.id).join(',');
    
    if (taskIds) {
      // Fetch events for these work items
      const eventPromises = clientTasks.map(task => 
        fetch(`/api/calendar-events?work_item_id=${task.id}`).then(r => r.json())
      );
      const eventArrays = await Promise.all(eventPromises);
      allEvents = eventArrays.flat();
    } else {
      allEvents = [];
    }
  } else {
    const res = await fetch(url);
    allEvents = await res.json();
  }
  
  // Add pending tasks as calendar events
  const pendingTaskEvents = allTasks
    .filter(task => task.status === 'pending')
    .map(task => ({
      id: `task-${task.id}`,
      title: task.title,
      description: task.description || '',
      event_date: task.due_date ? new Date(task.due_date).toISOString() : new Date().toISOString(),
      event_type: 'task',
      work_item_id: task.id,
      client_name: task.client_name,
      isPendingTask: true
    }));
  
  // Merge with existing events (avoid duplicates)
  const existingWorkItemIds = new Set(allEvents.filter(e => !e.isPendingTask).map(e => e.work_item_id));
  const uniquePendingEvents = pendingTaskEvents.filter(e => !existingWorkItemIds.has(e.work_item_id));
  allEvents = [...allEvents, ...uniquePendingEvents];
  
  render();
}

function getFilteredEvents() {
  const typeFilter = document.getElementById('filter-type').value;
  
  if (!typeFilter) return allEvents;
  
  return allEvents.filter(event => event.event_type === typeFilter);
}

function render() {
  renderCalendar();
  renderEventList();
  
  const filtered = getFilteredEvents();
  document.getElementById('event-count').textContent = `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`;
}

function renderCalendar() {
  if (currentView === 'month') {
    renderMonthView();
  } else {
    renderWeekView();
  }
  
  // Update period label
  const options = { year: 'numeric', month: 'long' };
  if (currentView === 'week') {
    const startOfWeek = getStartOfWeek(currentDate);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    document.getElementById('current-period').textContent = 
      `${startOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endOfWeek.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else {
    document.getElementById('current-period').textContent = currentDate.toLocaleDateString('en-US', options);
  }
}

function renderMonthView() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay(); // 0 = Sunday
  const totalDays = lastDay.getDate();
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const isToday = (d) => d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  const isPast = (d) => {
    const checkDate = new Date(d);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate < today;
  };
  
  let html = '';
  
  // Day headers
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  days.forEach(day => {
    html += `<div class="calendar-day-header">${day}</div>`;
  });
  
  // Empty cells before first day
  for (let i = 0; i < startDay; i++) {
    html += `<div class="calendar-day other-month"></div>`;
  }
  
  // Days of the month
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Find events for this day
    const dayEvents = getFilteredEvents().filter(event => {
      const eventDate = new Date(event.event_date);
      const eventDateStr = `${eventDate.getUTCFullYear()}-${String(eventDate.getUTCMonth() + 1).padStart(2, '0')}-${String(eventDate.getUTCDate()).padStart(2, '0')}`;
      return eventDateStr === dateStr;
    });
    
    const pastClass = isPast(date) ? 'past' : '';
    html += `<div class="calendar-day ${isToday(date) ? 'today' : ''} ${pastClass}">`;
    html += `<div class="calendar-day-number">${day}</div>`;
    
    dayEvents.slice(0, 4).forEach(event => {
      if (event.isPendingTask) {
        html += `<div class="calendar-event ${event.event_type}" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</div>`;
      } else {
        html += `<div class="calendar-event ${event.event_type}" onclick="editEvent(${event.id})" title="${escapeHtml(event.title)}">${escapeHtml(event.title)}</div>`;
      }
    });
    
    if (dayEvents.length > 4) {
      html += `<div style="font-size:10px; color:#6b7280;">+${dayEvents.length - 4} more</div>`;
    }
    
    html += '</div>';
  }
  
  // Fill remaining cells to complete the grid
  const totalCells = startDay + totalDays;
  const remainingCells = 7 - (totalCells % 7);
  if (remainingCells < 7) {
    for (let i = 0; i < remainingCells; i++) {
      html += `<div class="calendar-day other-month"></div>`;
    }
  }
  
  document.getElementById('calendar-grid').innerHTML = html;
}

function renderWeekView() {
  const startOfWeek = getStartOfWeek(currentDate);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  
  const filtered = getFilteredEvents();
  
  let html = '';
  for (let d = new Date(startOfWeek); d <= endOfWeek; d.setDate(d.getDate() + 1)) {
    const year = d.getFullYear();
    const month = d.getMonth();
    const day = d.getDate();
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    const dayEvents = filtered.filter(event => {
      const eventDate = new Date(event.event_date);
      const eventDateStr = `${eventDate.getUTCFullYear()}-${String(eventDate.getUTCMonth() + 1).padStart(2, '0')}-${String(eventDate.getUTCDate()).padStart(2, '0')}`;
      return eventDateStr === dateStr;
    });
    
    dayEvents.forEach(event => {
      html += eventItemHtml(event);
    });
  }
  
  document.getElementById('week-view').innerHTML = html || '<p class="empty-state">No events this week</p>';
}

function renderEventList() {
  const filtered = getFilteredEvents();
  const sorted = [...filtered].sort((a, b) => new Date(a.event_date) - new Date(b.event_date));
  
  let html = '<h3 style="margin-top:24px; margin-bottom:12px;">Upcoming Events</h3>';
  
  if (sorted.length === 0) {
    html += '<p class="empty-state">No events found</p>';
  } else {
    sorted.slice(0, 10).forEach(event => {
      html += eventItemHtml(event);
    });
  }
  
  document.getElementById('event-list').innerHTML = html;
}

function eventItemHtml(event) {
  const date = new Date(event.event_date);
  const day = event.isPendingTask ? date.getUTCDate() : date.getDate();
  const month = event.isPendingTask ? date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) : date.toLocaleDateString('en-US', { month: 'short' });
  const time = event.isPendingTask ? 'All day' : date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  
  return `
    <div class="event-item">
      <div class="event-date-box">
        <div class="event-date-day">${day}</div>
        <div class="event-date-month">${month}</div>
      </div>
      <div class="event-details">
        <div class="event-title">${escapeHtml(event.title)}</div>
        <div class="event-meta">
          <span class="badge ${event.event_type}">${event.event_type}${event.isPendingTask ? ' (pending)' : ''}</span>
          ${time}
          ${event.work_item_title ? `· ${escapeHtml(event.work_item_title)}` : ''}
        </div>
        ${event.description ? `<p style="font-size:13px; color:#6b7280; margin-top:4px;">${escapeHtml(event.description)}</p>` : ''}
      </div>
      <div>
        ${!event.isPendingTask ? `
        <button class="btn outline" style="padding:4px 8px; font-size:12px;" onclick="editEvent(${event.id})">Edit</button>
        <button class="btn danger" style="padding:4px 8px; font-size:12px;" onclick="openDeleteModal(${event.id})">Delete</button>
        ` : ''}
      </div>
    </div>
  `;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.getElementById('month-view').style.display = view === 'month' ? 'block' : 'none';
  document.getElementById('week-view').style.display = view === 'week' ? 'block' : 'none';
  render();
}

function previousPeriod() {
  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() - 1);
  } else {
    currentDate.setDate(currentDate.getDate() - 7);
  }
  render();
}

function nextPeriod() {
  if (currentView === 'month') {
    currentDate.setMonth(currentDate.getMonth() + 1);
  } else {
    currentDate.setDate(currentDate.getDate() + 7);
  }
  render();
}

function goToToday() {
  currentDate = new Date();
  render();
}

// Modal functions
function openCreateModal() {
  document.getElementById('modal-title').textContent = 'Add Event';
  document.getElementById('edit-id').value = '';
  document.getElementById('save-btn').textContent = 'Create';
  
  // Reset form
  document.getElementById('f-title').value = '';
  document.getElementById('f-description').value = '';
  document.getElementById('f-event-date').value = '';
  document.getElementById('f-event-type').value = 'task';
  document.getElementById('f-work-item').value = '';
  
  document.getElementById('event-modal').classList.add('open');
}

function editEvent(id) {
  const event = allEvents.find(e => e.id == id);
  if (!event) return;
  
  document.getElementById('modal-title').textContent = 'Edit Event';
  document.getElementById('edit-id').value = event.id;
  document.getElementById('save-btn').textContent = 'Update';
  
  document.getElementById('f-title').value = event.title;
  document.getElementById('f-description').value = event.description || '';
  
  // Format datetime for input
  const eventDate = new Date(event.event_date);
  const localISO = new Date(eventDate.getTime() - (eventDate.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  document.getElementById('f-event-date').value = localISO;
  
  document.getElementById('f-event-type').value = event.event_type;
  document.getElementById('f-work-item').value = event.work_item_id || '';
  
  document.getElementById('event-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('event-modal').classList.remove('open');
}

async function saveEvent() {
  const id = document.getElementById('edit-id').value;
  const title = document.getElementById('f-title').value.trim();
  const eventDate = document.getElementById('f-event-date').value;
  
  if (!title || !eventDate) {
    alert('Please fill in required fields (Title and Date)');
    return;
  }
  
  // Convert local datetime to UTC to avoid timezone shifts
  const localDate = new Date(eventDate);
  const utcDate = new Date(Date.UTC(
    localDate.getFullYear(),
    localDate.getMonth(),
    localDate.getDate(),
    localDate.getHours(),
    localDate.getMinutes(),
    localDate.getSeconds()
  )).toISOString();
  
  const data = {
    title: title,
    description: document.getElementById('f-description').value.trim(),
    event_date: utcDate,
    event_type: document.getElementById('f-event-type').value,
    work_item_id: document.getElementById('f-work-item').value ? parseInt(document.getElementById('f-work-item').value) : null,
    user_id: 1 // Default user_id=1 for now (no auth)
  };
  
  try {
    const url = id ? `/api/calendar-events/${id}` : '/api/calendar-events';
    const method = id ? 'PUT' : 'POST';
    
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to save event');
    }
    
    closeModal();
    await loadEvents();
  } catch (error) {
    alert('Error saving event: ' + error.message);
  }
}

// Delete functions
function openDeleteModal(id) {
  deleteId = id;
  document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
  deleteId = null;
  document.getElementById('delete-modal').classList.remove('open');
}

async function confirmDelete() {
  if (!deleteId) return;
  
  try {
    const res = await fetch(`/api/calendar-events/${deleteId}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Failed to delete event');
    }
    
    closeDeleteModal();
    await loadEvents();
  } catch (error) {
    alert('Error deleting event: ' + error.message);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Initialize
initCalendar();
