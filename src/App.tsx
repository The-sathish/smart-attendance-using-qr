/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, Component } from 'react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  serverTimestamp, 
  getDoc,
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db, handleFirestoreError, OperationType } from './firebase';
import { 
  User, 
  IdCard, 
  QrCode, 
  Users, 
  Download, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  BookOpen,
  School
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-red-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-6">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Session {
  id: string;
  subject: string;
  className?: string;
  active: boolean;
  createdAt: any;
}

interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentName: string;
  rollNumber: string;
  timestamp: any;
}

const AppContent = () => {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('sessionId');
  });
  
  const [isStudentView, setIsStudentView] = useState(false);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [subject, setSubject] = useState('');
  const [className, setClassName] = useState('');
  const [studentName, setStudentName] = useState('');
  const [rollNumber, setRollNumber] = useState('');

  // Determine view mode
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('sessionId');
    if (sid) {
      setIsStudentView(true);
      setSessionId(sid);
    } else {
      // Check local storage for teacher's active session
      const savedSessionId = localStorage.getItem('teacher_session_id');
      if (savedSessionId) {
        setSessionId(savedSessionId);
      }
    }
  }, []);

  // Fetch session details
  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    const sessionRef = doc(db, 'sessions', sessionId);
    const unsubscribe = onSnapshot(sessionRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setActiveSession({ id: docSnap.id, ...data } as Session);
      } else {
        setActiveSession(null);
        if (!isStudentView) {
          localStorage.removeItem('teacher_session_id');
          setSessionId(null);
        }
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `sessions/${sessionId}`);
    });

    return () => unsubscribe();
  }, [sessionId, isStudentView]);

  // Fetch attendance records for the session
  useEffect(() => {
    if (!sessionId || isStudentView) return;

    const q = query(
      collection(db, 'attendance'),
      where('sessionId', '==', sessionId),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AttendanceRecord[];
      setAttendance(records);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'attendance');
    });

    return () => unsubscribe();
  }, [sessionId, isStudentView]);

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim()) return;

    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'sessions'), {
        subject,
        className,
        active: true,
        createdAt: serverTimestamp()
      });
      setSessionId(docRef.id);
      localStorage.setItem('teacher_session_id', docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sessions');
    } finally {
      setLoading(false);
    }
  };

  const handleEndClass = async () => {
    if (!sessionId) return;
    try {
      await updateDoc(doc(db, 'sessions', sessionId), {
        active: false
      });
      localStorage.removeItem('teacher_session_id');
      setSessionId(null);
      setActiveSession(null);
      setAttendance([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `sessions/${sessionId}`);
    }
  };

  const handleSubmitAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionId || !studentName.trim() || !rollNumber.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      // Check for duplicate roll number in this session
      const q = query(
        collection(db, 'attendance'),
        where('sessionId', '==', sessionId),
        where('rollNumber', '==', rollNumber.trim())
      );
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        setError('This roll number has already submitted attendance for this session.');
        setSubmitting(false);
        return;
      }

      await addDoc(collection(db, 'attendance'), {
        sessionId,
        studentName: studentName.trim(),
        rollNumber: rollNumber.trim(),
        timestamp: serverTimestamp()
      });
      setSubmitted(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'attendance');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadCSV = () => {
    if (attendance.length === 0) return;

    const headers = ['Student Name', 'Roll Number', 'Time'];
    const rows = attendance.map(record => [
      record.studentName,
      record.rollNumber,
      record.timestamp ? format(record.timestamp.toDate(), 'yyyy-MM-dd HH:mm:ss') : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `attendance_${activeSession?.subject || 'class'}_${format(new Date(), 'yyyyMMdd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const studentAppUrl = useMemo(() => {
    if (!sessionId) return '';
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set('sessionId', sessionId);
    return url.toString();
  }, [sessionId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Student View
  if (isStudentView) {
    if (!activeSession || !activeSession.active) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Session Inactive</h1>
            <p className="text-gray-600 mb-6">
              This attendance session has ended or is no longer valid.
            </p>
          </div>
        </div>
      );
    }

    if (submitted) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
            <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Attendance Submitted!</h1>
            <p className="text-gray-600 mb-6">
              Thank you, {studentName}. Your attendance for {activeSession.subject} has been recorded.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 p-4 flex flex-col items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="bg-indigo-600 p-6 text-white text-center">
            <School className="w-10 h-10 mx-auto mb-2" />
            <h1 className="text-xl font-bold">Student Attendance</h1>
            <p className="text-indigo-100 opacity-90">{activeSession.subject} {activeSession.className && `(${activeSession.className})`}</p>
          </div>
          
          <form onSubmit={handleSubmitAttendance} className="p-6 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-sm">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p>{error}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  required
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  placeholder="Enter your name"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Roll Number</label>
              <div className="relative">
                <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  required
                  type="text"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                  placeholder="Enter your roll number"
                />
              </div>
            </div>
            
            <button
              disabled={submitting}
              type="submit"
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Mark Attendance'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Teacher View
  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <QrCode className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 hidden sm:block">QR Attendance</h1>
          </div>
          
          {sessionId && (
            <div className="flex items-center gap-2">
              <button
                onClick={downloadCSV}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Download CSV</span>
              </button>
              <button
                onClick={handleEndClass}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">End Class</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {!sessionId ? (
          <div className="max-w-md mx-auto">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Start New Session</h2>
                <p className="text-slate-500">Generate a QR code for your students to scan</p>
              </div>
              
              <form onSubmit={handleCreateSession} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subject Name</label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      required
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                      placeholder="e.g. Mathematics"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Class Name (Optional)</label>
                  <div className="relative">
                    <School className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                      type="text"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                      placeholder="e.g. Section A"
                    />
                  </div>
                </div>
                
                <button
                  type="submit"
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-[0.98]"
                >
                  Generate QR Code
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* QR Code Section */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sticky top-24">
                <div className="text-center mb-6">
                  <h3 className="text-lg font-bold text-slate-900">{activeSession?.subject}</h3>
                  <p className="text-sm text-slate-500">{activeSession?.className || 'General Class'}</p>
                </div>
                
                <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-center mb-6">
                  <QRCodeSVG 
                    value={studentAppUrl} 
                    size={200}
                    level="H"
                    includeMargin={true}
                  />
                </div>
                
                <div className="space-y-4">
                  <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                    <p className="text-xs font-medium text-indigo-600 uppercase tracking-wider mb-1">Scan to Join</p>
                    <p className="text-sm text-slate-700 break-all">{studentAppUrl}</p>
                  </div>
                </div>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex items-center gap-2 text-indigo-600 mb-1">
                    <Users className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase">Present</span>
                  </div>
                  <div className="text-2xl font-black text-slate-900">{attendance.length}</div>
                </div>
                <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                  <div className="flex items-center gap-2 text-emerald-600 mb-1">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-xs font-bold uppercase">Status</span>
                  </div>
                  <div className="text-2xl font-black text-slate-900">Live</div>
                </div>
              </div>
            </div>

            {/* Attendance List Section */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    Attendance List
                  </h3>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <th className="px-6 py-3 font-semibold">Student Name</th>
                        <th className="px-6 py-3 font-semibold">Roll Number</th>
                        <th className="px-6 py-3 font-semibold text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {attendance.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-slate-400 italic">
                            Waiting for students to scan the QR code...
                          </td>
                        </tr>
                      ) : (
                        attendance.map((record) => (
                          <tr key={record.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-4 font-medium text-slate-900">{record.studentName}</td>
                            <td className="px-6 py-4 text-slate-600">{record.rollNumber}</td>
                            <td className="px-6 py-4 text-slate-400 text-sm text-right">
                              {record.timestamp ? format(record.timestamp.toDate(), 'hh:mm:ss a') : '...'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
