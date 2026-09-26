const state = {
  selectedEmergency: null,
  peopleCount: 1,
};

const emergencyButtons = [...document.querySelectorAll('.emergency-option')];
const emergencySelection = document.getElementById('emergency-selection');
const emergencyMessage = document.getElementById('emergency-message');
const peopleCountElement = document.getElementById('people-count');
const decrementPeopleButton = document.getElementById('decrement-people');
const incrementPeopleButton = document.getElementById('increment-people');
const sendSosButton = document.getElementById('send-sos');
const requestScreen = document.getElementById('request-screen');
const confirmationScreen = document.getElementById('confirmation-screen');
const confirmationEmergency = document.getElementById('confirmation-emergency');
const confirmationPeople = document.getElementById('confirmation-people');
const otherIssueField = document.getElementById('other-issue-field');
const otherIssueInput = document.getElementById('other-issue');
const confirmationIssueRow = document.getElementById('confirmation-issue-row');
const confirmationIssue = document.getElementById('confirmation-issue');

const emergencyLabels = {
  medical: 'Medical',
  fire: 'Fire',
  trapped: 'Trapped',
  other: 'Other',
};

function renderPeopleCount() {
  peopleCountElement.textContent = String(state.peopleCount);
}

function setEmergencySelection(emergencyType) {
  state.selectedEmergency = emergencyType;
  otherIssueField.hidden = emergencyType !== 'other';
  if (emergencyType === 'other') {
    otherIssueInput.focus();
  }

  emergencyButtons.forEach((button) => {
    const selected = button.dataset.emergency === emergencyType;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });

  emergencySelection.classList.remove('invalid');
  emergencyMessage.classList.remove('visible');
  emergencyMessage.textContent = '';
}

function validateEmergencySelection() {
  return Boolean(state.selectedEmergency);
}

function buildSosObject() {
  return {
    emergencyType: state.selectedEmergency,
    peopleCount: state.peopleCount,
    ...(state.selectedEmergency === 'other' && {
      issueDescription: otherIssueInput.value.trim(),
    }),
  };
}

function showConfirmation() {
  const emergencyName = emergencyLabels[state.selectedEmergency] || 'Medical';
  confirmationEmergency.textContent = emergencyName;
  confirmationPeople.textContent = String(state.peopleCount);
  const issueDescription = state.selectedEmergency === 'other' ? otherIssueInput.value.trim() : '';
  confirmationIssueRow.hidden = !issueDescription;
  confirmationIssue.textContent = issueDescription;

  requestScreen.classList.remove('active');
  confirmationScreen.classList.add('active');
}

function handleEmergencyClick(event) {
  const button = event.currentTarget;
  const emergencyType = button.dataset.emergency;
  setEmergencySelection(emergencyType);
}

function handlePeopleChange(change) {
  const nextCount = state.peopleCount + change;
  if (nextCount < 1) {
    state.peopleCount = 1;
  } else {
    state.peopleCount = nextCount;
  }

  renderPeopleCount();
}

function handleSendSos() {
  if (!validateEmergencySelection()) {
    emergencySelection.classList.add('invalid');
    emergencyMessage.textContent = 'Please select an emergency type first.';
    emergencyMessage.classList.add('visible');
    return;
  }

  const sosObject = buildSosObject();
  console.log('net0 SOS payload:', sosObject);
  showConfirmation();
}

emergencyButtons.forEach((button) => {
  button.addEventListener('click', handleEmergencyClick);
});

decrementPeopleButton.addEventListener('click', () => handlePeopleChange(-1));
incrementPeopleButton.addEventListener('click', () => handlePeopleChange(1));
sendSosButton.addEventListener('click', handleSendSos);

renderPeopleCount();
