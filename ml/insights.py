import json
from pathlib import Path

import joblib

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / 'ml' / 'model' / 'churn_model.joblib'


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError('Model file not found. Run ml/train_model.py first.')

    artifact = joblib.load(MODEL_PATH)
    importance_map = artifact.get('importance_map', {})

    if not importance_map:
        raise ValueError('importance_map not found in artifact. Retrain the model first.')

    print(json.dumps({'importances': importance_map}))


if __name__ == '__main__':
    main()