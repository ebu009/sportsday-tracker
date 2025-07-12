/* global __app_id, __firebase_config, __initial_auth_token */
import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, onSnapshot, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';

// Create a context to provide Firebase and user data to components
const AppContext = createContext(null);

// Custom Modal component to replace alert/confirm
const Modal = ({ message, onConfirm, onCancel, showCancel = false }) => {
  if (!message) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-sm w-full text-center">
        <p className="text-lg font-semibold mb-4">{message}</p>
        <div className="flex justify-center space-x-4">
          <button
            onClick={onConfirm}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
          >
            OK
          </button>
          {showCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// --- Firebase Initialization and Authentication Wrapper ---
function AuthWrapper({ children }) {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        // Retrieve app ID and Firebase config from global variables
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

        // Initialize Firebase app
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);

        setDb(firestoreDb);
        setAuth(firebaseAuth);

        // Sign in with custom token or anonymously
        if (initialAuthToken) {
          await signInWithCustomToken(firebaseAuth, initialAuthToken);
        } else {
          await signInAnonymously(firebaseAuth);
        }

        // Listen for auth state changes
        const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
          if (user) {
            setUserId(user.uid);
          } else {
            // If user logs out or token expires, sign in anonymously again
            signInAnonymously(firebaseAuth).then((anonUser) => {
              setUserId(anonUser.user.uid);
            }).catch(e => console.error("Error signing in anonymously:", e));
          }
          setIsAuthReady(true);
          setLoading(false);
        });

        return () => unsubscribe(); // Cleanup auth listener
      } catch (e) {
        console.error("Failed to initialize Firebase:", e);
        setError("Failed to initialize the application. Please try again later.");
        setLoading(false);
      }
    };

    initializeFirebase();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">Loading Sports Day Tracker...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4">
        <p>{error}</p>
      </div>
    );
  }

  // Provide Firebase instances and user info to children
  return (
    <AppContext.Provider value={{ db, auth, userId, isAuthReady }}>
      {children}
    </AppContext.Provider>
  );
}

// --- Event Management Component ---
const EventList = ({ onEditEvent, onAddScore, onShowScores }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [events, setEvents] = useState([]);
  const [modalMessage, setModalMessage] = useState('');
  const [modalAction, setModalAction] = useState(null);
  const [selectedEventId, setSelectedEventId] = useState(null);

  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const eventsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_events`);
      const unsubscribe = onSnapshot(eventsColRef, (snapshot) => {
        const eventsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort events by name
        eventsData.sort((a, b) => a.name.localeCompare(b.name));
        setEvents(eventsData);
      }, (error) => {
        console.error("Error fetching events:", error);
      });
      return () => unsubscribe();
    }
  }, [db, isAuthReady]);

  const handleDeleteEvent = (eventId) => {
    setModalMessage("Are you sure you want to delete this event? This action cannot be undone.");
    setModalAction(() => async () => {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/sportsday_events`, eventId));
        // Also delete associated scores
        const scoresQuery = query(collection(db, `artifacts/${appId}/public/data/sportsday_scores`), where("eventId", "==", eventId));
        const scoresSnapshot = await getDocs(scoresQuery);
        scoresSnapshot.forEach(async (scoreDoc) => {
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/sportsday_scores`, scoreDoc.id));
        });
        setModalMessage("Event and its scores deleted successfully!");
        setModalAction(null);
      } catch (e) {
        console.error("Error deleting event:", e);
        setModalMessage("Error deleting event: " + e.message);
        setModalAction(null);
      }
    });
    setSelectedEventId(eventId);
  };

  const closeModal = () => {
    setModalMessage('');
    setModalAction(null);
    setSelectedEventId(null);
  };

  const confirmModal = () => {
    if (modalAction) {
      modalAction();
    }
    closeModal();
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Events</h2>
      <Modal
        message={modalMessage}
        onConfirm={confirmModal}
        onCancel={closeModal}
        showCancel={modalAction !== null} // Only show cancel if there's an action pending
      />
      {events.length === 0 ? (
        <p className="text-gray-600 italic">No events added yet. Add one to get started!</p>
      ) : (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gray-50 p-4 rounded-lg shadow-sm hover:shadow-md transition duration-200">
              <div className="flex-grow mb-2 sm:mb-0">
                <p className="text-lg font-semibold text-gray-800">{event.name}</p>
                <p className="text-sm text-gray-600">{event.type}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onAddScore(event.id, event.name)}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  Add Score
                </button>
                <button
                  onClick={() => onShowScores(event.id, event.name)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  View Scores
                </button>
                <button
                  onClick={() => onEditEvent(event)}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteEvent(event.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// --- Participant Management Component ---
const ParticipantList = ({ onEditParticipant }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [participants, setParticipants] = useState([]);
  const [modalMessage, setModalMessage] = useState('');
  const [modalAction, setModalAction] = useState(null);
  const [selectedParticipantId, setSelectedParticipantId] = useState(null);

  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const participantsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_participants`);
      const unsubscribe = onSnapshot(participantsColRef, (snapshot) => {
        const participantsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort participants by name
        participantsData.sort((a, b) => a.name.localeCompare(b.name));
        setParticipants(participantsData);
      }, (error) => {
        console.error("Error fetching participants:", error);
      });
      return () => unsubscribe();
    }
  }, [db, isAuthReady]);

  const handleDeleteParticipant = (participantId) => {
    setModalMessage("Are you sure you want to delete this participant? This will also delete all their scores.");
    setModalAction(() => async () => {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        await deleteDoc(doc(db, `artifacts/${appId}/public/data/sportsday_participants`, participantId));
        // Also delete associated scores
        const scoresQuery = query(collection(db, `artifacts/${appId}/public/data/sportsday_scores`), where("participantId", "==", participantId));
        const scoresSnapshot = await getDocs(scoresQuery);
        scoresSnapshot.forEach(async (scoreDoc) => {
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/sportsday_scores`, scoreDoc.id));
        });
        setModalMessage("Participant and their scores deleted successfully!");
        setModalAction(null);
      } catch (e) {
        console.error("Error deleting participant:", e);
        setModalMessage("Error deleting participant: " + e.message);
        setModalAction(null);
      }
    });
    setSelectedParticipantId(participantId);
  };

  const closeModal = () => {
    setModalMessage('');
    setModalAction(null);
    setSelectedParticipantId(null);
  };

  const confirmModal = () => {
    if (modalAction) {
      modalAction();
    }
    closeModal();
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Participants</h2>
      <Modal
        message={modalMessage}
        onConfirm={confirmModal}
        onCancel={closeModal}
        showCancel={modalAction !== null}
      />
      {participants.length === 0 ? (
        <p className="text-gray-600 italic">No participants added yet. Add one to get started!</p>
      ) : (
        <ul className="space-y-4">
          {participants.map((participant) => (
            <li key={participant.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gray-50 p-4 rounded-lg shadow-sm hover:shadow-md transition duration-200">
              <div className="flex-grow mb-2 sm:mb-0">
                <p className="text-lg font-semibold text-gray-800">{participant.name}</p>
                <p className="text-sm text-gray-600">House: {participant.house || 'N/A'}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => onEditParticipant(participant)}
                  className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDeleteParticipant(participant.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition duration-200 text-sm"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// --- Form for Adding/Editing Events ---
const EventForm = ({ eventToEdit, onSave, onCancel }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [name, setName] = useState(eventToEdit ? eventToEdit.name : '');
  const [type, setType] = useState(eventToEdit ? eventToEdit.type : '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (eventToEdit) {
      setName(eventToEdit.name);
      setType(eventToEdit.type);
    } else {
      setName('');
      setType('');
    }
    setError('');
  }, [eventToEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !type.trim()) {
      setError("Event name and type cannot be empty.");
      return;
    }

    if (!db || !isAuthReady) {
      setError("Database not ready. Please wait.");
      return;
    }

    const eventData = { name: name.trim(), type: type.trim() };
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    try {
      if (eventToEdit) {
        // Update existing event
        await updateDoc(doc(db, `artifacts/${appId}/public/data/sportsday_events`, eventToEdit.id), eventData);
      } else {
        // Add new event
        await addDoc(collection(db, `artifacts/${appId}/public/data/sportsday_events`), eventData);
      }
      onSave(); // Go back to dashboard
    } catch (e) {
      console.error("Error saving event:", e);
      setError("Failed to save event: " + e.message);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">{eventToEdit ? 'Edit Event' : 'Add New Event'}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="eventName" className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
          <input
            type="text"
            id="eventName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 100m Sprint"
            required
          />
        </div>
        <div>
          <label htmlFor="eventType" className="block text-sm font-medium text-gray-700 mb-1">Event Type</label>
          <input
            type="text"
            id="eventType"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Track, Field"
            required
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex space-x-4">
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
          >
            {eventToEdit ? 'Update Event' : 'Add Event'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

// --- Form for Adding/Editing Participants ---
const ParticipantForm = ({ participantToEdit, onSave, onCancel }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [name, setName] = useState(participantToEdit ? participantToEdit.name : '');
  const [house, setHouse] = useState(participantToEdit ? participantToEdit.house : '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (participantToEdit) {
      setName(participantToEdit.name);
      setHouse(participantToEdit.house);
    } else {
      setName('');
      setHouse('');
    }
    setError('');
  }, [participantToEdit]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Participant name cannot be empty.");
      return;
    }

    if (!db || !isAuthReady) {
      setError("Database not ready. Please wait.");
      return;
    }

    const participantData = { name: name.trim(), house: house.trim() };
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

    try {
      if (participantToEdit) {
        // Update existing participant
        await updateDoc(doc(db, `artifacts/${appId}/public/data/sportsday_participants`, participantToEdit.id), participantData);
      } else {
        // Add new participant
        await addDoc(collection(db, `artifacts/${appId}/public/data/sportsday_participants`), participantData);
      }
      onSave(); // Go back to dashboard
    } catch (e) {
      console.error("Error saving participant:", e);
      setError("Failed to save participant: " + e.message);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">{participantToEdit ? 'Edit Participant' : 'Add New Participant'}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="participantName" className="block text-sm font-medium text-gray-700 mb-1">Participant Name</label>
          <input
            type="text"
            id="participantName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., John Doe"
            required
          />
        </div>
        <div>
          <label htmlFor="participantHouse" className="block text-sm font-medium text-gray-700 mb-1">House (Optional)</label>
          <input
            type="text"
            id="participantHouse"
            value={house}
            onChange={(e) => setHouse(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., Gryffindor"
          />
        </div>
        {error && <p className="text-red-600 text-sm">{error}</p>}
        <div className="flex space-x-4">
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
          >
            {participantToEdit ? 'Update Participant' : 'Add Participant'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

// --- Score Entry Component ---
const ScoreEntry = ({ eventId, eventName, onSave, onCancel }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [participants, setParticipants] = useState([]);
  const [scores, setScores] = useState({}); // { participantId: score }
  const [existingScores, setExistingScores] = useState({}); // { participantId: scoreDocId }
  const [error, setError] = useState('');
  const [loadingParticipants, setLoadingParticipants] = useState(true);

  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const participantsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_participants`);
      const scoresColRef = collection(db, `artifacts/${appId}/public/data/sportsday_scores`);

      // Fetch participants
      const unsubscribeParticipants = onSnapshot(participantsColRef, (snapshot) => {
        const participantsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        participantsData.sort((a, b) => a.name.localeCompare(b.name));
        setParticipants(participantsData);
        setLoadingParticipants(false);
      }, (err) => {
        console.error("Error fetching participants for score entry:", err);
        setError("Failed to load participants.");
        setLoadingParticipants(false);
      });

      // Fetch existing scores for this event
      const q = query(scoresColRef, where("eventId", "==", eventId));
      const unsubscribeScores = onSnapshot(q, (snapshot) => {
        const currentScores = {};
        const currentExistingScores = {};
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          currentScores[data.participantId] = data.score;
          currentExistingScores[data.participantId] = doc.id;
        });
        setScores(currentScores);
        setExistingScores(currentExistingScores);
      }, (err) => {
        console.error("Error fetching existing scores:", err);
      });

      return () => {
        unsubscribeParticipants();
        unsubscribeScores();
      };
    }
  }, [db, isAuthReady, eventId]);

  const handleScoreChange = (participantId, value) => {
    // Allow empty string or numbers
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setScores(prev => ({ ...prev, [participantId]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!db || !isAuthReady) {
      setError("Database not ready. Please wait.");
      return;
    }

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const scoresColRef = collection(db, `artifacts/${appId}/public/data/sportsday_scores`);

    try {
      for (const participant of participants) {
        const scoreValue = scores[participant.id];
        if (scoreValue !== undefined && scoreValue !== null && scoreValue !== '') {
          const scoreData = {
            eventId: eventId,
            participantId: participant.id,
            score: parseFloat(scoreValue), // Convert to number
            timestamp: new Date(),
          };

          if (existingScores[participant.id]) {
            // Update existing score
            await updateDoc(doc(db, `artifacts/${appId}/public/data/sportsday_scores`, existingScores[participant.id]), scoreData);
          } else {
            // Add new score
            await addDoc(scoresColRef, scoreData);
          }
        } else if (existingScores[participant.id]) {
          // If score is cleared and an existing score exists, delete it
          await deleteDoc(doc(db, `artifacts/${appId}/public/data/sportsday_scores`, existingScores[participant.id]));
        }
      }
      onSave(); // Go back to dashboard
    } catch (e) {
      console.error("Error saving scores:", e);
      setError("Failed to save scores: " + e.message);
    }
  };

  if (loadingParticipants) {
    return <div className="text-center py-8 text-gray-600">Loading participants...</div>;
  }

  if (participants.length === 0) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Enter Scores for {eventName}</h2>
        <p className="text-gray-600 italic">No participants available. Please add participants first.</p>
        <button
          onClick={onCancel}
          className="mt-4 px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Enter Scores for {eventName}</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {participants.map((participant) => (
          <div key={participant.id} className="flex items-center space-x-4">
            <label htmlFor={`score-${participant.id}`} className="block text-lg font-medium text-gray-700 w-48 truncate">
              {participant.name} ({participant.house})
            </label>
            <input
              type="number"
              step="0.01" // Allow decimal scores
              id={`score-${participant.id}`}
              value={scores[participant.id] !== undefined ? scores[participant.id] : ''}
              onChange={(e) => handleScoreChange(participant.id, e.target.value)}
              className="flex-grow px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Score"
            />
          </div>
        ))}
        {error && <p className="text-red-600 text-sm mt-4">{error}</p>}
        <div className="flex space-x-4 mt-6">
          <button
            type="submit"
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200"
          >
            Save Scores
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

// --- View Scores for a Specific Event Component ---
const EventScoresView = ({ eventId, eventName, onBack }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [eventScores, setEventScores] = useState([]);
  const [participantsMap, setParticipantsMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const scoresColRef = collection(db, `artifacts/${appId}/public/data/sportsday_scores`);
      const participantsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_participants`);

      // Fetch participants once to create a map
      const fetchParticipants = async () => {
        const snapshot = await getDocs(participantsColRef);
        const map = {};
        snapshot.docs.forEach(doc => {
          map[doc.id] = doc.data();
        });
        setParticipantsMap(map);
      };

      fetchParticipants();

      // Listen for scores for this event
      const q = query(scoresColRef, where("eventId", "==", eventId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const scoresData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Sort scores (e.g., by score value, highest first)
        scoresData.sort((a, b) => b.score - a.score);
        setEventScores(scoresData);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching event scores:", error);
        setLoading(false);
      });

      return () => unsubscribe();
    }
  }, [db, isAuthReady, eventId]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading scores...</div>;
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Scores for {eventName}</h2>
      {eventScores.length === 0 ? (
        <p className="text-gray-600 italic">No scores recorded for this event yet.</p>
      ) : (
        <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-sm">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Participant</th>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">House</th>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Score</th>
            </tr>
          </thead>
          <tbody>
            {eventScores.map((score) => (
              <tr key={score.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-800">{participantsMap[score.participantId]?.name || 'Unknown Participant'}</td>
                <td className="py-3 px-4 text-gray-600">{participantsMap[score.participantId]?.house || 'N/A'}</td>
                <td className="py-3 px-4 text-gray-800 font-medium">{score.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        onClick={onBack}
        className="mt-6 px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
      >
        Back to Dashboard
      </button>
    </div>
  );
};

// --- Overall Standings Component ---
const OverallStandings = () => {
  const { db, isAuthReady } = useContext(AppContext);
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const scoresColRef = collection(db, `artifacts/${appId}/public/data/sportsday_scores`);
      const participantsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_participants`);

      const unsubscribe = onSnapshot(scoresColRef, async (scoresSnapshot) => {
        const allScores = scoresSnapshot.docs.map(doc => doc.data());

        // Fetch all participants
        const participantsSnapshot = await getDocs(participantsColRef);
        const participantsMap = {};
        participantsSnapshot.docs.forEach(doc => {
          participantsMap[doc.id] = doc.data();
        });

        // Calculate total scores for each participant
        const participantScores = {};
        allScores.forEach(score => {
          if (participantScores[score.participantId]) {
            participantScores[score.participantId] += score.score;
          } else {
            participantScores[score.participantId] = score.score;
          }
        });

        // Create standings array
        const calculatedStandings = Object.keys(participantScores).map(participantId => ({
          participantId,
          name: participantsMap[participantId]?.name || 'Unknown',
          house: participantsMap[participantId]?.house || 'N/A',
          totalScore: participantScores[participantId],
        }));

        // Sort by total score (highest first)
        calculatedStandings.sort((a, b) => b.totalScore - a.totalScore);
        setStandings(calculatedStandings);
        setLoading(false);
      }, (error) => {
        console.error("Error fetching overall standings:", error);
        setLoading(false);
      });

      return () => unsubscribe();
    }
  }, [db, isAuthReady]);

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Calculating standings...</div>;
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Overall Standings</h2>
      {standings.length === 0 ? (
        <p className="text-gray-600 italic">No scores recorded yet to calculate standings.</p>
      ) : (
        <table className="min-w-full bg-white rounded-lg overflow-hidden shadow-sm">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Rank</th>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Participant</th>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">House</th>
              <th className="py-3 px-4 text-left text-sm font-semibold text-gray-700">Total Score</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing, index) => (
              <tr key={standing.participantId} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-800 font-bold">{index + 1}</td>
                <td className="py-3 px-4 text-gray-800">{standing.name}</td>
                <td className="py-3 px-4 text-gray-600">{standing.house}</td>
                <td className="py-3 px-4 text-gray-800 font-medium">{standing.totalScore.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// --- Stopwatch Component ---
const Stopwatch = ({ onBack }) => {
  const { db, isAuthReady } = useContext(AppContext);
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // in milliseconds
  const [laps, setLaps] = useState([]);
  const intervalRef = useRef(null);
  const startTimeRef = useRef(0);

  const [events, setEvents] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [selectedParticipant, setSelectedParticipant] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  // Fetch events and participants for score saving
  useEffect(() => {
    if (db && isAuthReady) {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const eventsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_events`);
      const participantsColRef = collection(db, `artifacts/${appId}/public/data/sportsday_participants`);

      const unsubscribeEvents = onSnapshot(eventsColRef, (snapshot) => {
        const eventsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        eventsData.sort((a, b) => a.name.localeCompare(b.name));
        setEvents(eventsData);
      }, (error) => {
        console.error("Error fetching events for stopwatch:", error);
      });

      const unsubscribeParticipants = onSnapshot(participantsColRef, (snapshot) => {
        const participantsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        participantsData.sort((a, b) => a.name.localeCompare(b.name));
        setParticipants(participantsData);
      }, (error) => {
        console.error("Error fetching participants for stopwatch:", error);
      });

      return () => {
        unsubscribeEvents();
        unsubscribeParticipants();
      };
    }
  }, [db, isAuthReady]);

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now() - elapsedTime;
      intervalRef.current = setInterval(() => {
        setElapsedTime(Date.now() - startTimeRef.current);
      }, 10); // Update every 10 milliseconds for smoother display
    } else {
      clearInterval(intervalRef.current);
    }

    return () => clearInterval(intervalRef.current);
  }, [isRunning, elapsedTime]);

  const formatTime = (timeInMs) => {
    const minutes = Math.floor(timeInMs / 60000);
    const seconds = Math.floor((timeInMs % 60000) / 1000);
    const milliseconds = Math.floor((timeInMs % 1000) / 10); // Two digits for milliseconds

    return (
      String(minutes).padStart(2, '0') + ':' +
      String(seconds).padStart(2, '0') + '.' +
      String(milliseconds).padStart(2, '0')
    );
  };

  const startStopwatch = () => {
    setIsRunning(true);
    setSaveMessage('');
  };

  const stopStopwatch = () => {
    setIsRunning(false);
  };

  const resetStopwatch = () => {
    setIsRunning(false);
    setElapsedTime(0);
    setLaps([]);
    setSaveMessage('');
  };

  const lapStopwatch = () => {
    if (isRunning) {
      setLaps(prevLaps => [...prevLaps, elapsedTime]);
    }
  };

  const handleSaveScore = async () => {
    if (!selectedEvent || !selectedParticipant) {
      setSaveMessage("Please select both an event and a participant.");
      return;
    }
    if (elapsedTime === 0) {
      setSaveMessage("Stopwatch time is 0. Please run the stopwatch first.");
      return;
    }

    if (!db || !isAuthReady) {
      setSaveMessage("Database not ready. Please wait.");
      return;
    }

    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const scoresColRef = collection(db, `artifacts/${appId}/public/data/sportsday_scores`);

    try {
      // Convert milliseconds to seconds for score storage
      const scoreInSeconds = elapsedTime / 1000;

      // Check if a score already exists for this participant in this event
      const q = query(scoresColRef, where("eventId", "==", selectedEvent), where("participantId", "==", selectedParticipant));
      const existingScores = await getDocs(q);

      const scoreData = {
        eventId: selectedEvent,
        participantId: selectedParticipant,
        score: scoreInSeconds, // Store in seconds
        timestamp: new Date(),
      };

      if (existingScores.docs.length > 0) {
        // Update existing score
        await updateDoc(doc(db, `artifacts/${appId}/public/data/sportsday_scores`, existingScores.docs[0].id), scoreData);
        setSaveMessage("Score updated successfully!");
      } else {
        // Add new score
        await addDoc(scoresColRef, scoreData);
        setSaveMessage("Score saved successfully!");
      }

      // Optionally, reset stopwatch or clear selections after saving
      // resetStopwatch();
      // setSelectedEvent('');
      // setSelectedParticipant('');

    } catch (e) {
      console.error("Error saving score from stopwatch:", e);
      setSaveMessage("Failed to save score: " + e.message);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-lg mb-8">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-3">Stopwatch</h2>

      <div className="text-center mb-8">
        <div className="text-6xl font-mono font-bold text-blue-700 mb-4 bg-blue-50 p-6 rounded-xl shadow-inner">
          {formatTime(elapsedTime)}
        </div>
        <div className="flex justify-center space-x-4">
          {!isRunning ? (
            <button
              onClick={startStopwatch}
              className="px-6 py-3 bg-green-600 text-white rounded-full shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 transition duration-200 text-lg"
            >
              Start
            </button>
          ) : (
            <button
              onClick={stopStopwatch}
              className="px-6 py-3 bg-red-600 text-white rounded-full shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition duration-200 text-lg"
            >
              Stop
            </button>
          )}
          <button
            onClick={lapStopwatch}
            className="px-6 py-3 bg-indigo-600 text-white rounded-full shadow-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-50 transition duration-200 text-lg"
            disabled={!isRunning}
          >
            Lap
          </button>
          <button
            onClick={resetStopwatch}
            className="px-6 py-3 bg-gray-400 text-gray-800 rounded-full shadow-md hover:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-opacity-50 transition duration-200 text-lg"
          >
            Reset
          </button>
        </div>
      </div>

      {laps.length > 0 && (
        <div className="mb-8">
          <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2">Lap Times</h3>
          <ul className="space-y-2 max-h-48 overflow-y-auto pr-2">
            {laps.map((lapTime, index) => (
              <li key={index} className="flex justify-between items-center bg-gray-50 p-3 rounded-md text-gray-700 font-mono">
                <span>Lap {index + 1}:</span>
                <span className="font-semibold">{formatTime(lapTime)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t pt-6 mt-6">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Record Time as Score</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="selectEvent" className="block text-sm font-medium text-gray-700 mb-1">Select Event</label>
            <select
              id="selectEvent"
              value={selectedEvent}
              onChange={(e) => setSelectedEvent(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Choose Event --</option>
              {events.map(event => (
                <option key={event.id} value={event.id}>{event.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="selectParticipant" className="block text-sm font-medium text-gray-700 mb-1">Select Participant</label>
            <select
              id="selectParticipant"
              value={selectedParticipant}
              onChange={(e) => setSelectedParticipant(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Choose Participant --</option>
              {participants.map(participant => (
                <option key={participant.id} value={participant.id}>{participant.name} ({participant.house})</option>
              ))}
            </select>
          </div>
          {saveMessage && (
            <p className={`text-sm ${saveMessage.includes('successfully') ? 'text-green-600' : 'text-red-600'}`}>
              {saveMessage}
            </p>
          )}
          <button
            onClick={handleSaveScore}
            className="px-6 py-3 bg-blue-600 text-white rounded-md shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition duration-200 text-lg w-full"
          >
            Save Current Time as Score
          </button>
        </div>
      </div>

      <button
        onClick={onBack}
        className="mt-8 px-6 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 transition duration-200"
      >
        Back to Dashboard
      </button>
    </div>
  );
};


// --- Main Dashboard Component ---
const Dashboard = ({ onViewChange, currentView, eventToEdit, participantToEdit, eventForScoreEntry, eventForScoresView }) => {
  const { userId } = useContext(AppContext);

  const renderContent = () => {
    switch (currentView) {
      case 'add-event':
        return <EventForm onSave={() => onViewChange('dashboard')} onCancel={() => onViewChange('dashboard')} />;
      case 'edit-event':
        return <EventForm eventToEdit={eventToEdit} onSave={() => onViewChange('dashboard')} onCancel={() => onViewChange('dashboard')} />;
      case 'add-participant':
        return <ParticipantForm onSave={() => onViewChange('dashboard')} onCancel={() => onViewChange('dashboard')} />;
      case 'edit-participant':
        return <ParticipantForm participantToEdit={participantToEdit} onSave={() => onViewChange('dashboard')} onCancel={() => onViewChange('dashboard')} />;
      case 'add-score':
        return <ScoreEntry eventId={eventForScoreEntry.id} eventName={eventForScoreEntry.name} onSave={() => onViewChange('dashboard')} onCancel={() => onViewChange('dashboard')} />;
      case 'view-event-scores':
        return <EventScoresView eventId={eventForScoresView.id} eventName={eventForScoresView.name} onBack={() => onViewChange('dashboard')} />;
      case 'stopwatch':
        return <Stopwatch onBack={() => onViewChange('dashboard')} />;
      case 'dashboard':
      default:
        return (
          <>
            <EventList
              onEditEvent={(event) => { onViewChange('edit-event', event); }}
              onAddScore={(id, name) => { onViewChange('add-score', { id, name }); }}
              onShowScores={(id, name) => { onViewChange('view-event-scores', { id, name }); }}
            />
            <ParticipantList
              onEditParticipant={(participant) => { onViewChange('edit-participant', participant); }}
            />
            <OverallStandings />
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-indigo-600 p-4 sm:p-8 font-sans">
      <header className="text-center text-white mb-8">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-2 drop-shadow-lg">
          Sports Day Tracker
        </h1>
        <p className="text-lg sm:text-xl font-light opacity-90">Manage events, participants, and scores with ease.</p>
        {userId && (
          <p className="text-sm mt-2 opacity-80">
            Your User ID: <span className="font-mono bg-white bg-opacity-20 px-2 py-1 rounded-md text-xs">{userId}</span>
          </p>
        )}
      </header>

      <div className="max-w-4xl mx-auto">
        {currentView === 'dashboard' && (
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <button
              onClick={() => onViewChange('add-event')}
              className="flex items-center px-6 py-3 bg-white text-blue-700 rounded-full shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition duration-300 font-semibold text-lg"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Add Event
            </button>
            <button
              onClick={() => onViewChange('add-participant')}
              className="flex items-center px-6 py-3 bg-white text-green-700 rounded-full shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition duration-300 font-semibold text-lg"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
              Add Participant
            </button>
            <button
              onClick={() => onViewChange('stopwatch')}
              className="flex items-center px-6 py-3 bg-white text-purple-700 rounded-full shadow-lg hover:shadow-xl transform hover:-translate-y-1 transition duration-300 font-semibold text-lg"
            >
              <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
              Stopwatch
            </button>
          </div>
        )}

        {renderContent()}
      </div>
    </div>
  );
};

// --- Main App Component ---
function App() {
  const [currentView, setCurrentView] = useState('dashboard');
  const [eventToEdit, setEventToEdit] = useState(null);
  const [participantToEdit, setParticipantToEdit] = useState(null);
  const [eventForScoreEntry, setEventForScoreEntry] = useState(null);
  const [eventForScoresView, setEventForScoresView] = useState(null);

  const handleViewChange = (view, data = null) => {
    setCurrentView(view);
    setEventToEdit(null);
    setParticipantToEdit(null);
    setEventForScoreEntry(null);
    setEventForScoresView(null);

    if (view === 'edit-event') {
      setEventToEdit(data);
    } else if (view === 'edit-participant') {
      setParticipantToEdit(data);
    } else if (view === 'add-score') {
      setEventForScoreEntry(data);
    } else if (view === 'view-event-scores') {
      setEventForScoresView(data);
    }
  };

  return (
    <AuthWrapper>
      <Dashboard
        currentView={currentView}
        onViewChange={handleViewChange}
        eventToEdit={eventToEdit}
        participantToEdit={participantToEdit}
        eventForScoreEntry={eventForScoreEntry}
        eventForScoresView={eventForScoresView}
      />
    </AuthWrapper>
  );
}

export default App;
